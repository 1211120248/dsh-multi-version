import { randomUUID } from 'node:crypto'
import { WorkspaceUnavailableError } from './core/types.ts'
import type {
  CandidateExecutionRequest,
  CandidateExecutionResult,
  CandidateExecutor,
  CapturedSubmission,
  JsonValue,
  SubmissionPart,
  VersionBrief,
  VersionPlanner,
  VersionPlannerRequest,
  WorkspaceResolver,
} from './core/types.ts'
import { validateBriefs } from './core/invariant.ts'

interface SessionEventLike {
  readonly type: string
  readonly data?: {
    readonly message?: { readonly content?: readonly ContentBlockLike[] }
    readonly chunk?: { readonly type?: string; readonly text?: string }
    readonly reason?: unknown
    readonly commandId?: unknown
  }
}

type ContentBlockLike =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: JsonValue }
  | { readonly type: string; readonly [key: string]: unknown }

interface AttachmentServiceLike {
  saveImages(images: readonly {
    readonly data: Uint8Array
    readonly mediaType: string
    readonly name?: string
  }[]): Promise<readonly JsonValue[]>
}

interface AgentContextLike {
  get(name: string): unknown
  on?: (
    event: 'agent/pre-step',
    handler: (
      input: { readonly agent: { readonly session: { append(type: string, data: unknown): unknown } } },
      next: () => Promise<{ readonly kind?: string }>,
    ) => Promise<unknown>,
  ) => unknown
  readonly systemPrompt?: {
    context(input: { readonly name: string; readonly order: number; readonly text: string }): unknown
  }
}

const ONE_SHOT_DESCRIPTOR_VERSION = 2

function installOneShotDescriptor(childContext: unknown, label: string): void {
  const context = childContext as AgentContextLike
  if (typeof context.on !== 'function') {
    throw new Error('dsh-multi-version requires the DSH agent/pre-step lifecycle for one-shot child classification')
  }
  let appended = false
  context.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (!appended && decision.kind === 'enter') {
      appended = true
      agent.session.append('subagent/descriptor', {
        version: ONE_SHOT_DESCRIPTOR_VERSION,
        mode: 'one-shot',
        provider: 'multi-version',
        label,
      })
    }
    return decision
  })
}

interface AgentLike {
  readonly id: string
  readonly ctx: AgentContextLike
  readonly options?: {
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
    readonly subagentDepth?: number
  }
  readonly session: {
    readonly header: {
      readonly cwd?: string
      readonly delegationDepth?: number
      readonly agentPreset?: string
    }
    readonly events: readonly SessionEventLike[]
    append(type: string, data: unknown): unknown
  }
  followup(message: unknown): void
  whenIdle(): Promise<void>
  cancel(reason?: unknown): unknown
}

interface AgentHandleLike {
  readonly agent: AgentLike
  dispose(): void | Promise<void>
}

interface AgentRegistryLike {
  get(sessionId: string): AgentLike | undefined
  create(options: {
    readonly sessionId: string
    readonly meta: {
      readonly cwd: string
      readonly parentSession: string
      readonly origin: 'subagent'
      readonly delegationDepth: number
      readonly seedLength: 0
      readonly agentPreset?: string
    }
    readonly agentOptions?: unknown
    readonly setup?: (childContext: unknown) => void
  }): Promise<AgentHandleLike>
}

interface AgentPresetServiceLike {
  composedPreset(context: unknown): string | undefined
  composeFrom(childContext: unknown, parentContext: unknown): string | undefined
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('multi-version execution aborted')
}

function userMessage(content: readonly ContentBlockLike[]): unknown {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: content.map(block => Object.freeze({ ...block })),
    source: Object.freeze({ kind: 'user' }),
  })
}

async function submissionBlocks(
  submission: CapturedSubmission,
  attachments: AttachmentServiceLike,
): Promise<readonly ContentBlockLike[]> {
  const imageParts = submission.parts.filter((part): part is Extract<SubmissionPart, { type: 'image' }> => part.type === 'image')
  const refs = await attachments.saveImages(imageParts.map(part => ({
    data: new Uint8Array(Buffer.from(part.data, 'base64')),
    mediaType: part.mediaType,
    ...(part.name === undefined ? {} : { name: part.name }),
  })))
  let imageIndex = 0
  return submission.parts.map((part): ContentBlockLike => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    const attachment = refs[imageIndex]
    imageIndex += 1
    if (attachment === undefined) throw new Error('attachment service returned too few image references')
    return { type: 'image', attachment }
  })
}

function finalAssistantOutput(events: readonly SessionEventLike[]): readonly ContentBlockLike[] | undefined {
  let message: readonly ContentBlockLike[] | undefined
  const partial: string[] = []
  for (const event of events) {
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      if (content !== undefined && content.length > 0) message = content
    } else if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      const text = event.data.chunk.text
      if (text !== undefined && text !== '') partial.push(text)
    }
  }
  if (message !== undefined) return message
  const text = partial.join('')
  return text === '' ? undefined : [{ type: 'text', text }]
}

function markdownOf(blocks: readonly ContentBlockLike[]): string {
  return blocks.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n').trim()
}

function jsonValueOf(blocks: readonly ContentBlockLike[]): JsonValue {
  return JSON.parse(JSON.stringify(blocks)) as JsonValue
}

function failureMessage(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.message === 'string' && row.message !== '') return row.message
  return failureMessage(row.error) ?? failureMessage(row.failure)
}

function terminalFailure(events: readonly SessionEventLike[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'turn/end') continue
    const reason = event.data?.reason
    if (typeof reason !== 'object' || reason === null) return 'child agent ended without a valid terminal reason'
    const kind = (reason as Record<string, unknown>).kind
    if (kind === 'completed') return undefined
    if (kind === 'error') return failureMessage(reason) ?? 'child agent stopped with an error'
    return failureMessage(reason) ?? `child agent stopped with terminal reason "${typeof kind === 'string' ? kind : 'unknown'}"`
  }
  return 'child agent produced no terminal turn event'
}

/** Resolves only an active Host-owned session; the browser never supplies a path. */
export class DshWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly agents: AgentRegistryLike) {}

  async resolve(sessionId: string): Promise<string> {
    const parent = this.agents.get(sessionId)
    const cwd = parent?.session.header.cwd
    if (parent === undefined || cwd === undefined || cwd.trim() === '') {
      throw new WorkspaceUnavailableError(`active session "${sessionId}" has no Host-owned workspace`)
    }
    return cwd
  }
}

class DshChildRunner {
  constructor(
    private readonly agents: AgentRegistryLike,
    private readonly presets?: AgentPresetServiceLike,
  ) {}

  async run(
    parentSession: string,
    cwd: string,
    content: readonly ContentBlockLike[],
    signal: AbortSignal,
    label: string,
  ): Promise<readonly ContentBlockLike[]> {
    signal.throwIfAborted()
    const parent = this.agents.get(parentSession)
    if (parent === undefined) throw new Error(`parent session "${parentSession}" is not active`)
    const childId = randomUUID()
    const runtimeDepth = parent.options?.subagentDepth ?? 0
    if (!Number.isSafeInteger(runtimeDepth) || runtimeDepth < 0) throw new Error('parent runtime delegation depth is invalid')
    const childDepth = Math.max(parent.session.header.delegationDepth ?? 0, runtimeDepth) + 1
    if (!Number.isSafeInteger(childDepth)) throw new Error('child delegation depth exceeds the safe-integer range')
    const composedPreset = this.presets?.composedPreset(parent.ctx) ?? parent.session.header.agentPreset
    const sandboxMode = (parent.ctx.get('sandboxPolicy') as {
      overrideOf(session: AgentLike['session']): string | undefined
    } | undefined)?.overrideOf(parent.session)
    const hasApproval = parent.ctx.get('approval') !== undefined
    const agentOptions = {
      ...(parent.options?.provider === undefined ? {} : { provider: parent.options.provider }),
      ...(parent.options?.model === undefined ? {} : { model: parent.options.model }),
      ...(parent.options?.maxTokens === undefined ? {} : { maxTokens: parent.options.maxTokens }),
      subagentDepth: childDepth,
    }
    let handle: AgentHandleLike | undefined
    const cancel = (): void => { handle?.agent.cancel(abortError(signal)) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      handle = await this.agents.create({
        sessionId: childId,
        meta: {
          cwd,
          parentSession,
          origin: 'subagent',
          delegationDepth: childDepth,
          seedLength: 0,
          ...(composedPreset === undefined ? {} : { agentPreset: composedPreset }),
        },
        agentOptions,
        setup: (childContext: unknown) => {
          this.presets?.composeFrom(childContext, parent.ctx)
          const context = childContext as AgentContextLike
          context.systemPrompt?.context({
            name: 'subagent:delegation',
            order: 120,
            text: 'You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session. Operations that require approval are rejected automatically.',
          })
          installOneShotDescriptor(context, label)
        },
      })
      if (sandboxMode !== undefined) {
        handle.agent.session.append('sandbox/mode', { mode: sandboxMode, source: 'delegation' })
      }
      if (hasApproval) {
        handle.agent.session.append('approval/policy', { policy: 'never', source: 'delegation' })
      }
      if (signal.aborted) {
        handle.agent.cancel(abortError(signal))
        throw abortError(signal)
      }
      handle.agent.followup(userMessage(content))
      await handle.agent.whenIdle()
      if (signal.aborted) throw abortError(signal)
      const failure = terminalFailure(handle.agent.session.events)
      if (failure !== undefined) throw new Error(`child agent failed: ${failure}`)
      const output = finalAssistantOutput(handle.agent.session.events)
      if (output === undefined || markdownOf(output) === '') {
        throw new Error('child agent completed without a final assistant response')
      }
      return output
    } finally {
      signal.removeEventListener('abort', cancel)
      if (handle !== undefined) await handle.dispose()
    }
  }
}

async function candidateContent(
  request: CandidateExecutionRequest,
  attachments: AttachmentServiceLike,
): Promise<readonly ContentBlockLike[]> {
  const submission = await submissionBlocks(request.submission, attachments)
  if (request.brief === undefined) return submission
  const brief = request.brief
  return [
    {
      type: 'text',
      text: [
        'Follow this approved implementation brief while fulfilling the user request. Do not compare or rank other versions.',
        `Title: ${brief.title}`,
        `Direction: ${brief.description}`,
        `Instruction: ${brief.instruction}`,
      ].join('\n'),
    },
    ...submission,
  ]
}

/** Fresh one-shot child execution with explicit candidate cwd and no history seed. */
export class DshCandidateExecutor implements CandidateExecutor {
  private readonly runner: DshChildRunner

  constructor(
    agents: AgentRegistryLike,
    private readonly attachments: AttachmentServiceLike,
    presets?: AgentPresetServiceLike,
  ) {
    this.runner = new DshChildRunner(agents, presets)
  }

  async execute(request: CandidateExecutionRequest, signal: AbortSignal): Promise<CandidateExecutionResult> {
    const output = await this.runner.run(
      request.sessionId,
      request.cwd,
      await candidateContent(request, this.attachments),
      signal,
      `multi-version candidate ${request.versionId}`,
    )
    return { markdown: markdownOf(output), raw: jsonValueOf(output) }
  }
}

async function plannerContent(
  submission: CapturedSubmission,
  requestedCount: number,
  attachments: AttachmentServiceLike,
): Promise<readonly ContentBlockLike[]> {
  return [
    {
      type: 'text',
      text: [
        'Create implementation directions for the user request that follows.',
        `Return exactly ${requestedCount} genuinely distinct briefs as strict JSON and nothing else.`,
        'Use this schema: {"briefs":[{"title":"...","description":"...","instruction":"..."}]}.',
        'Do not solve the request, rank directions, recommend one, merge them, or add commentary.',
      ].join('\n'),
    },
    ...await submissionBlocks(submission, attachments),
  ]
}

function parsePlannerOutput(markdown: string, requestedCount: number): readonly VersionBrief[] {
  const start = markdown.indexOf('{')
  const end = markdown.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('planner response contains no JSON object')
  const parsed = JSON.parse(markdown.slice(start, end + 1)) as { readonly briefs?: unknown }
  if (!Array.isArray(parsed.briefs)) throw new Error('planner JSON has no briefs array')
  const briefs = parsed.briefs.map((value, index): VersionBrief => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`planner brief ${index + 1} is not an object`)
    }
    const row = value as Record<string, unknown>
    if (typeof row.title !== 'string' || typeof row.description !== 'string' || typeof row.instruction !== 'string') {
      throw new Error(`planner brief ${index + 1} has invalid fields`)
    }
    return { title: row.title, description: row.description, instruction: row.instruction }
  })
  validateBriefs(briefs, requestedCount)
  return briefs
}

/** One isolated planner child; invalid or duplicate directions fail the whole run. */
export class DshVersionPlanner implements VersionPlanner {
  private readonly runner: DshChildRunner

  constructor(
    agents: AgentRegistryLike,
    private readonly attachments: AttachmentServiceLike,
    presets?: AgentPresetServiceLike,
  ) {
    this.runner = new DshChildRunner(agents, presets)
  }

  async plan(request: VersionPlannerRequest, signal: AbortSignal): Promise<readonly VersionBrief[]> {
    const output = await this.runner.run(
      request.sessionId,
      request.cwd,
      await plannerContent(request.submission, request.requestedCount, this.attachments),
      signal,
      `multi-version planner ${request.runId}`,
    )
    return parsePlannerOutput(markdownOf(output), request.requestedCount)
  }
}

export type { AgentPresetServiceLike, AgentRegistryLike, AttachmentServiceLike, SubmissionPart }
