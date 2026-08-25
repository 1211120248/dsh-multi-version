import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { validateSessionId } from './core/invariant.ts'
import { MULTI_VERSION_API_PREFIX, parseActionEnvelope } from './core/protocol.ts'
import { toRunView } from './core/run-view.ts'
import type { RunPhase, RunRecord, RunView, RuntimeSources, VersionResult } from './core/types.ts'
import { RunCoordinator, type RunRecordPublicationReason } from './run-coordinator.ts'
import {
  DshCandidateExecutor,
  DshVersionPlanner,
  DshWorkspaceResolver,
  type AgentPresetServiceLike,
  type AgentRegistryLike,
  type AttachmentServiceLike,
} from './dsh-runtime.ts'

const API_ROOT = MULTI_VERSION_API_PREFIX
const MAX_BODY_BYTES = 34 * 1024 * 1024
const MAX_REQUEST_CACHE = 1_000

interface WebRouteLike {
  readonly kind: 'prefix'
  readonly path: string
  readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

interface WebServerLike {
  register(route: WebRouteLike): () => void
}

interface HostContextLike {
  get(name: string): unknown
  effect(factory: () => (() => void) | void, label?: string): void
}

interface JsonSuccess {
  readonly ok: true
  readonly value: unknown
}

interface JsonFailure {
  readonly ok: false
  readonly error: string
}

type JsonResult = JsonSuccess | JsonFailure

function sources(): RuntimeSources {
  return { now: () => new Date(), randomId: () => randomUUID() }
}

const COMMAND_NAME = 'multi-version'
const TERMINAL_PHASES = new Set<RunPhase>(['completed', 'cancelled', 'failed', 'interrupted'])

function commandId(runId: string): string {
  return `multi-version:${runId}`
}

function loopback(address: string | undefined): boolean {
  if (address === undefined) return false
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || address.startsWith('127.')
}

function trusted(request: IncomingMessage): boolean {
  if (!loopback(request.socket.remoteAddress)) return false
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function send(response: ServerResponse, status: number, body: JsonResult): void {
  const json = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(json),
  })
  response.end(json)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  if (bytes === 0) throw new Error('request body is empty')
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function sessionIdFrom(url: URL): string {
  const sessionId = url.searchParams.get('sessionId') ?? ''
  validateSessionId(sessionId)
  return sessionId
}

function identifierFrom(url: URL, name: 'runId' | 'versionId', pattern: RegExp): string {
  const value = url.searchParams.get(name) ?? ''
  if (!pattern.test(value)) throw new Error(`invalid ${name}`)
  return value
}

/** Host authority for route admission, workspace derivation, child execution, and ledger reads. */
export class MultiVersionHostService {
  readonly coordinator: RunCoordinator
  private readonly requests = new Map<string, Promise<JsonResult>>()

  constructor(
    private readonly agents: AgentRegistryLike,
    attachments: AttachmentServiceLike,
    presets?: AgentPresetServiceLike,
  ) {
    this.coordinator = new RunCoordinator({
      workspaceResolver: new DshWorkspaceResolver(agents),
      executor: new DshCandidateExecutor(agents, attachments, presets),
      planner: new DshVersionPlanner(agents, attachments, presets),
      sources: sources(),
      publish: (record, reason) => { this.publishConversationLifecycle(record, reason) },
    })
  }

  private publishConversationLifecycle(record: RunRecord, reason: RunRecordPublicationReason): void {
    const agent = this.agents.get(record.sessionId)
    if (agent === undefined) return
    const id = commandId(record.id)
    let started = agent.session.events.some(event => event.type === 'command/run' && event.data?.commandId === id)
    if (!started && reason === 'started') {
      agent.session.append('command/run', {
        commandId: id,
        name: COMMAND_NAME,
        args: record.id,
        source: { kind: 'user' },
      })
      started = true
    }
    if (!started || !TERMINAL_PHASES.has(record.phase)) return
    const settled = agent.session.events.some(event => event.type === 'command/done' && event.data?.commandId === id)
    if (settled) return
    if (record.phase === 'completed') {
      agent.session.append('command/done', {
        commandId: id,
        kind: 'success',
        text: `${record.options.count} versions completed.`,
      })
      return
    }
    agent.session.append('command/done', {
      commandId: id,
      kind: 'error',
      text: record.error ?? `Multi-version run ended with phase ${record.phase}.`,
    })
  }

  async action(input: unknown): Promise<JsonResult> {
    const envelope = parseActionEnvelope(input)
    if (envelope === undefined) return { ok: false, error: 'invalid action envelope' }
    const existing = this.requests.get(envelope.requestId)
    if (existing !== undefined) return existing
    const pending = (async (): Promise<JsonResult> => {
      if (envelope.action.kind === 'start') {
        const runId = await this.coordinator.start(envelope.action.request)
        return { ok: true, value: { runId } }
      }
      return { ok: true, value: { cancelled: this.coordinator.cancel(envelope.action.sessionId, envelope.action.runId) } }
    })().catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }))
    this.requests.set(envelope.requestId, pending)
    while (this.requests.size > MAX_REQUEST_CACHE) {
      const oldest = this.requests.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.requests.delete(oldest)
    }
    return pending
  }

  async runs(sessionId: string): Promise<readonly RunView[]> {
    return (await this.coordinator.runsForSession(sessionId)).map(toRunView)
  }

  async result(sessionId: string, runId: string, versionId: string): Promise<VersionResult> {
    return this.coordinator.resultForSession(sessionId, runId, versionId)
  }
}

/** Register the loopback-only HTTP face beneath the existing DSH Web server. */
export function installHostRoutes(context: unknown): MultiVersionHostService {
  const ctx = context as HostContextLike
  const agents = ctx.get('agents') as AgentRegistryLike | undefined
  const webServer = ctx.get('webServer') as WebServerLike | undefined
  const attachments = ctx.get('attachments') as AttachmentServiceLike | undefined
  const presets = ctx.get('agentPresets') as AgentPresetServiceLike | undefined
  if (agents === undefined) throw new Error('dsh-multi-version requires the agents service')
  if (webServer === undefined) throw new Error('dsh-multi-version requires the webServer service')
  if (attachments === undefined) throw new Error('dsh-multi-version requires the attachments service')
  const service = new MultiVersionHostService(agents, attachments, presets)
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: API_ROOT,
    handler: async (request, response) => {
      if (!trusted(request)) {
        send(response, 403, { ok: false, error: 'forbidden' })
        return
      }
      const url = new URL(request.url ?? API_ROOT, `http://${request.headers.host ?? '127.0.0.1'}`)
      try {
        if (request.method === 'POST' && url.pathname === `${API_ROOT}/action`) {
          const result = await service.action(await readJson(request))
          send(response, result.ok ? 202 : 400, result)
          return
        }
        if (request.method === 'GET' && url.pathname === `${API_ROOT}/runs`) {
          send(response, 200, { ok: true, value: await service.runs(sessionIdFrom(url)) })
          return
        }
        if (request.method === 'GET' && url.pathname === `${API_ROOT}/result`) {
          const sessionId = sessionIdFrom(url)
          const runId = identifierFrom(url, 'runId', /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
          const versionId = identifierFrom(url, 'versionId', /^version-[0-9]{2}$/)
          send(response, 200, { ok: true, value: await service.result(sessionId, runId, versionId) })
          return
        }
        send(response, 404, { ok: false, error: 'not found' })
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        send(response, text === 'request body is too large' ? 413 : 400, { ok: false, error: text })
      }
    },
  }), 'dsh-multi-version: Host routes')
  return service
}
