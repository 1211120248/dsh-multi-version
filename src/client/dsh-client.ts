import { MULTI_VERSION_API_PREFIX } from '../core/protocol.ts'
import type {
  CapturedSubmission,
  RunView,
  StartRunRequest,
  SubmissionPart,
} from '../core/types.ts'
import type {
  ConversationInputAdapter,
  MultiVersionHostTransport,
  PreparedComposerSubmission,
} from './input-adapter.ts'

const API_ROOT = MULTI_VERSION_API_PREFIX

interface ComposerOccurrenceLike {
  readonly source: string
  readonly ref: string
  readonly offset: number
  readonly length: number
  readonly invalid?: boolean
}

interface ComposerStateLike {
  readonly draft: string
  readonly draftRev: number
  readonly imageIds: readonly string[]
  readonly occurrences: readonly ComposerOccurrenceLike[]
  readonly phase: string
}

interface SessionInputLike {
  readonly state: { getSnapshot(): ComposerStateLike }
  commitSend(imageIds: readonly string[]): void
}

interface EncodedImageLike {
  readonly mediaType: string
  readonly data: string
  readonly name?: string
}

interface ConversationLike {
  readonly input?: { for(scope: ScopeLike): SessionInputLike }
  serializeDraftImages?: (imageIds: readonly string[]) => Promise<readonly EncodedImageLike[]>
  draftImages?: (imageIds: readonly string[]) => readonly unknown[]
  releaseDraftImages?: (attachments: readonly unknown[]) => void
}

interface ReferenceControllerLike {
  serializeReference(source: string, ref: string, signal: AbortSignal): Promise<string>
}

interface InputTriggersLike {
  sessionOf(scope: ScopeLike): ReferenceControllerLike
}

interface ScopeLike {
  get(name: string): unknown
}

interface SessionsLike {
  scope(sessionId: string): ScopeLike | undefined
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameOccurrences(left: readonly ComposerOccurrenceLike[], right: readonly ComposerOccurrenceLike[]): boolean {
  return left.length === right.length && left.every((value, index) => {
    const other = right[index]
    return other !== undefined
      && value.source === other.source
      && value.ref === other.ref
      && value.offset === other.offset
      && value.length === other.length
      && value.invalid === other.invalid
  })
}

async function serializeReferences(
  draft: string,
  occurrences: readonly ComposerOccurrenceLike[],
  controller: ReferenceControllerLike,
): Promise<string> {
  if (occurrences.length === 0) return draft.trim()
  const signal = new AbortController().signal
  const ordered = [...occurrences].sort((left, right) => left.offset - right.offset)
  const replacements = await Promise.all(ordered.map(async occurrence => ({
    ...occurrence,
    text: await controller.serializeReference(occurrence.source, occurrence.ref, signal),
  })))
  let output = ''
  let cursor = 0
  for (const replacement of replacements) {
    if (replacement.offset < cursor || replacement.offset + replacement.length > draft.length) {
      throw new Error('composer reference ranges are inconsistent')
    }
    output += draft.slice(cursor, replacement.offset) + replacement.text
    cursor = replacement.offset + replacement.length
  }
  return `${output}${draft.slice(cursor)}`.trim()
}

/** Atomic compatibility lease over current DSH session state and reference/image codecs. */
export class DshConversationInputAdapter implements ConversationInputAdapter {
  private readonly active = new Set<string>()

  constructor(
    private readonly sessions: SessionsLike,
    private readonly inputTriggers?: InputTriggersLike,
  ) {}

  supports(sessionId: string): boolean {
    try {
      const scope = this.sessions.scope(sessionId)
      const conversation = scope?.get('conversation') as ConversationLike | undefined
      if (scope === undefined || conversation === undefined) return false
      const input = conversation.input?.for(scope)
      return input !== undefined
        && typeof input.commitSend === 'function'
        && typeof conversation.serializeDraftImages === 'function'
        && typeof conversation.draftImages === 'function'
        && typeof conversation.releaseDraftImages === 'function'
        && this.inputTriggers !== undefined
    } catch {
      return false
    }
  }

  async prepare(sessionId: string): Promise<PreparedComposerSubmission | null> {
    if (this.active.has(sessionId)) throw new Error('a composer submission lease is already active for this session')
    const scope = this.sessions.scope(sessionId)
    const conversation = scope?.get('conversation') as ConversationLike | undefined
    if (scope === undefined || conversation === undefined) return null
    this.active.add(sessionId)
    try {
      const prepared = await this.prepareCompatible(sessionId, scope, conversation)
      if (prepared === null) this.active.delete(sessionId)
      return prepared
    } catch (error) {
      this.active.delete(sessionId)
      throw error
    }
  }

  private async prepareCompatible(
    sessionId: string,
    scope: ScopeLike,
    conversation: ConversationLike,
  ): Promise<PreparedComposerSubmission | null> {
    if (this.inputTriggers === undefined
      || conversation.input === undefined
      || conversation.serializeDraftImages === undefined
      || conversation.draftImages === undefined
      || conversation.releaseDraftImages === undefined) return null
    const input = conversation.input.for(scope)
    if (typeof input.commitSend !== 'function') return null
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain') throw new Error('the composer is busy or owned by another input command')
    if (snapshot.draft.trim() === '' && snapshot.imageIds.length === 0) return null
    if (snapshot.occurrences.some(occurrence => occurrence.invalid === true)) {
      throw new Error('the composer contains an unresolved reference')
    }

    const imageIds = [...snapshot.imageIds]
    const [text, images] = await Promise.all([
      serializeReferences(snapshot.draft, snapshot.occurrences, this.inputTriggers.sessionOf(scope)),
      conversation.serializeDraftImages(imageIds),
    ])
    if (images.length !== imageIds.length) throw new Error('composer image serialization returned an incomplete result')
    const parts: SubmissionPart[] = [
      ...images.map((image): SubmissionPart => ({
        type: 'image', mediaType: image.mediaType, data: image.data,
        ...(image.name === undefined ? {} : { name: image.name }),
      })),
      ...(text === '' ? [] : [{ type: 'text' as const, text }]),
    ]
    const submission: CapturedSubmission = {
      parts,
      preview: snapshot.draft.trim().slice(0, 2_000),
    }
    return this.wrap(sessionId, submission, () => {
      const current = input.state.getSnapshot()
      if (current.phase !== 'plain'
        || current.draftRev !== snapshot.draftRev
        || current.draft !== snapshot.draft
        || !sameIds(current.imageIds, imageIds)
        || !sameOccurrences(current.occurrences, snapshot.occurrences)) return false
      const attachments = conversation.draftImages!(imageIds)
      if (attachments.length !== imageIds.length) return false
      input.commitSend(imageIds)
      conversation.releaseDraftImages!(attachments)
      return true
    }, () => {})
  }

  private wrap(
    sessionId: string,
    submission: CapturedSubmission,
    commit: () => boolean,
    rollback: () => void,
  ): PreparedComposerSubmission {
    let closed = false
    const close = (): void => {
      closed = true
      this.active.delete(sessionId)
    }
    return {
      submission,
      commit: () => {
        if (closed) return false
        try {
          return commit()
        } finally {
          close()
        }
      },
      rollback: () => {
        if (closed) return
        try {
          rollback()
        } finally {
          close()
        }
      },
    }
  }
}

interface ApiResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: string
}

async function readResult<T>(response: Response): Promise<T> {
  const body = await response.json() as ApiResult<T>
  if (!response.ok || !body.ok || body.value === undefined) {
    throw new Error(body.error ?? `multi-version Host request failed (${response.status})`)
  }
  return body.value
}

function query(values: Record<string, string>): string {
  return new URLSearchParams(values).toString()
}

/** Same-origin loopback transport; paths and shell commands never cross this boundary. */
export class DshMultiVersionTransport implements MultiVersionHostTransport {
  async start(request: StartRunRequest): Promise<{ readonly runId: string }> {
    return this.action<{ readonly runId: string }>({
      requestId: crypto.randomUUID(),
      action: { kind: 'start', request },
    })
  }

  async cancel(sessionId: string, runId: string): Promise<boolean> {
    const result = await this.action<{ readonly cancelled: boolean }>({
      requestId: crypto.randomUUID(),
      action: { kind: 'cancel', sessionId, runId },
    })
    return result.cancelled
  }

  async runs(sessionId: string): Promise<readonly RunView[]> {
    return this.get<readonly RunView[]>('runs', { sessionId })
  }

  private async get<T>(route: string, values: Record<string, string>): Promise<T> {
    const response = await fetch(`${API_ROOT}/${route}?${query(values)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
    return readResult<T>(response)
  }

  private async action<T>(body: unknown): Promise<T> {
    const response = await fetch(`${API_ROOT}/action`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
    return readResult<T>(response)
  }
}

export type { InputTriggersLike, SessionsLike }
