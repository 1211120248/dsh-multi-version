import type { CapturedSubmission, RunOptions, StartRunRequest, SubmissionPart } from './types.ts'
import { validateSessionId, validateStartRequest } from './invariant.ts'

export const MULTI_VERSION_API_PREFIX = '/api/dsh-multi-version/v1'
export const MAX_REQUEST_ID_LENGTH = 128

export type MultiVersionAction =
  | { readonly kind: 'start'; readonly request: StartRunRequest }
  | { readonly kind: 'cancel'; readonly sessionId: string; readonly runId: string }

export interface ActionEnvelope {
  readonly requestId: string
  readonly action: MultiVersionAction
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed)
  return Object.keys(value).every(key => set.has(key))
}

function part(value: unknown): SubmissionPart | undefined {
  const candidate = object(value)
  if (candidate?.type === 'text' && typeof candidate.text === 'string' && onlyKeys(candidate, ['type', 'text'])) {
    return { type: 'text', text: candidate.text }
  }
  if (candidate?.type !== 'image' || typeof candidate.mediaType !== 'string' || typeof candidate.data !== 'string' || !onlyKeys(candidate, ['type', 'mediaType', 'data', 'name'])) return undefined
  if (candidate.name !== undefined && typeof candidate.name !== 'string') return undefined
  return {
    type: 'image',
    mediaType: candidate.mediaType,
    data: candidate.data,
    ...(candidate.name === undefined ? {} : { name: candidate.name }),
  }
}

function submission(value: unknown): CapturedSubmission | undefined {
  const candidate = object(value)
  if (candidate === undefined || !onlyKeys(candidate, ['parts', 'preview']) || !Array.isArray(candidate.parts) || typeof candidate.preview !== 'string') return undefined
  const parts = candidate.parts.map(part)
  if (parts.some(item => item === undefined)) return undefined
  return { parts: parts as SubmissionPart[], preview: candidate.preview }
}

function options(value: unknown): RunOptions | undefined {
  const candidate = object(value)
  if (candidate === undefined || !onlyKeys(candidate, ['count', 'usePlanner', 'concurrency']) || typeof candidate.count !== 'number' || typeof candidate.usePlanner !== 'boolean' || typeof candidate.concurrency !== 'number') return undefined
  return { count: candidate.count, usePlanner: candidate.usePlanner, concurrency: candidate.concurrency }
}

function startRequest(value: unknown): StartRunRequest | undefined {
  const candidate = object(value)
  if (candidate === undefined || !onlyKeys(candidate, ['sessionId', 'submission', 'options']) || typeof candidate.sessionId !== 'string') return undefined
  const parsedSubmission = submission(candidate.submission)
  const parsedOptions = options(candidate.options)
  if (parsedSubmission === undefined || parsedOptions === undefined) return undefined
  const request = { sessionId: candidate.sessionId, submission: parsedSubmission, options: parsedOptions }
  try {
    validateStartRequest(request)
  } catch {
    return undefined
  }
  return request
}

export function parseActionEnvelope(value: unknown): ActionEnvelope | undefined {
  const envelope = object(value)
  const action = object(envelope?.action)
  const requestId = envelope?.requestId
  if (typeof requestId !== 'string'
    || requestId === ''
    || requestId !== requestId.trim()
    || requestId.length > MAX_REQUEST_ID_LENGTH
    || envelope === undefined
    || action === undefined
    || !onlyKeys(envelope, ['requestId', 'action'])) return undefined
  if (action.kind === 'start') {
    if (!onlyKeys(action, ['kind', 'request'])) return undefined
    const request = startRequest(action.request)
    return request === undefined ? undefined : { requestId, action: { kind: 'start', request } }
  }
  if (action.kind === 'cancel'
    && onlyKeys(action, ['kind', 'sessionId', 'runId'])
    && typeof action.sessionId === 'string'
    && typeof action.runId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(action.runId)) {
    try {
      validateSessionId(action.sessionId)
    } catch {
      return undefined
    }
    return { requestId, action: { kind: 'cancel', sessionId: action.sessionId, runId: action.runId } }
  }
  return undefined
}
