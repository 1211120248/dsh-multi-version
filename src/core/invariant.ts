import type { CapturedSubmission, RunOptions, StartRunRequest, VersionBrief } from './types.ts'

export const MIN_VERSION_COUNT = 2
export const MAX_VERSION_COUNT = 20
export const MAX_CONCURRENCY = 8
export const MAX_PROMPT_BYTES = 32 * 1024 * 1024
export const MAX_IMAGE_COUNT = 20
export const MAX_SESSION_ID_LENGTH = 200

const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export function validateRunOptions(options: RunOptions): void {
  if (!Number.isSafeInteger(options.count) || options.count < MIN_VERSION_COUNT || options.count > MAX_VERSION_COUNT) {
    throw new Error(`version count must be an integer from ${MIN_VERSION_COUNT} to ${MAX_VERSION_COUNT}`)
  }
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > MAX_CONCURRENCY) {
    throw new Error(`concurrency must be an integer from 1 to ${MAX_CONCURRENCY}`)
  }
  if (options.concurrency > options.count) throw new Error('concurrency cannot exceed version count')
}

export function validateSubmission(submission: CapturedSubmission): void {
  if (submission.parts.length === 0) throw new Error('submission must not be empty')
  if (submission.preview.length > 2_000) throw new Error('submission preview is too long')
  let bytes = 0
  let images = 0
  let hasContent = false
  for (const part of submission.parts) {
    if (part.type === 'text') {
      bytes += new TextEncoder().encode(part.text).byteLength
      hasContent ||= part.text !== ''
      continue
    }
    images += 1
    hasContent = true
    if (!/^image\/[a-z0-9.+-]+$/i.test(part.mediaType)) throw new Error('invalid image media type')
    if (part.data.length === 0 || part.data.length % 4 !== 0 || !CANONICAL_BASE64.test(part.data)) throw new Error('image data must be canonical base64')
    bytes += part.data.length
  }
  if (!hasContent) throw new Error('submission must contain text or an image')
  if (images > MAX_IMAGE_COUNT) throw new Error(`submission exceeds the ${MAX_IMAGE_COUNT}-image limit`)
  if (bytes > MAX_PROMPT_BYTES) throw new Error('submission exceeds the maximum encoded size')
}

export function validateSessionId(sessionId: string): void {
  if (sessionId === '' || sessionId !== sessionId.trim() || sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new Error('sessionId is invalid')
  }
}

export function validateStartRequest(request: StartRunRequest): void {
  validateSessionId(request.sessionId)
  validateSubmission(request.submission)
  validateRunOptions(request.options)
}

export function validateBriefs(briefs: readonly VersionBrief[], requestedCount: number): void {
  if (briefs.length !== requestedCount) throw new Error(`planner returned ${briefs.length} briefs; expected ${requestedCount}`)
  const directions = new Set<string>()
  for (const [index, brief] of briefs.entries()) {
    if (brief.title.trim() === '') throw new Error(`planner brief ${index + 1} has no title`)
    if (brief.description.trim() === '') throw new Error(`planner brief ${index + 1} has no description`)
    if (brief.instruction.trim() === '') throw new Error(`planner brief ${index + 1} has no instruction`)
    const direction = `${brief.title}\n${brief.description}\n${brief.instruction}`.trim().toLocaleLowerCase()
    if (directions.has(direction)) throw new Error(`planner brief ${index + 1} duplicates an earlier direction`)
    directions.add(direction)
  }
}

export function safeRunId(timestamp: Date, suffix: string): string {
  const date = timestamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
  if (safeSuffix === '') throw new Error('random id source returned no safe characters')
  return `${date}-${safeSuffix}`
}

export function versionId(index: number): string {
  if (!Number.isSafeInteger(index) || index < 1) throw new Error('version index must be a positive integer')
  return `version-${String(index).padStart(2, '0')}`
}
