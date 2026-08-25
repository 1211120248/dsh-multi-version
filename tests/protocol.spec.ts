import { describe, expect, it } from 'vitest'
import { parseActionEnvelope } from '../src/core/protocol.ts'

const valid = {
  requestId: 'request-1',
  action: {
    kind: 'start',
    request: {
      sessionId: 'session-1',
      submission: { preview: 'Build it', parts: [{ type: 'text', text: 'Build it' }] },
      options: { count: 3, usePlanner: false, concurrency: 2 },
    },
  },
}

describe('parseActionEnvelope', () => {
  it('accepts a strict start envelope', () => {
    expect(parseActionEnvelope(valid)).toEqual(valid)
  })

  it.each([
    { ...valid, outputDirectory: '/tmp/escape' },
    { ...valid, action: { ...valid.action, command: 'rm -rf .' } },
    { ...valid, action: { ...valid.action, request: { ...valid.action.request, workspace: '/tmp/escape' } } },
    { ...valid, action: { ...valid.action, request: { ...valid.action.request, options: { ...valid.action.request.options, shell: 'bash' } } } },
  ])('rejects unowned path and command fields', (candidate) => {
    expect(parseActionEnvelope(candidate)).toBeUndefined()
  })

  it('requires the owning session on cancellation', () => {
    expect(parseActionEnvelope({
      requestId: 'cancel-1',
      action: { kind: 'cancel', sessionId: 'session-1', runId: 'run-1' },
    })).toEqual({
      requestId: 'cancel-1',
      action: { kind: 'cancel', sessionId: 'session-1', runId: 'run-1' },
    })
    expect(parseActionEnvelope({ requestId: 'cancel-2', action: { kind: 'cancel', runId: 'run-1' } }))
      .toBeUndefined()
    expect(parseActionEnvelope({ requestId: 'cancel-3', action: { kind: 'cancel', sessionId: ' session-1 ', runId: 'run-1' } }))
      .toBeUndefined()
    expect(parseActionEnvelope({ requestId: 'cancel-4', action: { kind: 'cancel', sessionId: 'session-1', runId: '../escape' } }))
      .toBeUndefined()
  })

  it('rejects oversized request identifiers', () => {
    expect(parseActionEnvelope({ ...valid, requestId: 'x'.repeat(129) })).toBeUndefined()
  })

  it('rejects non-canonical image payloads', () => {
    expect(parseActionEnvelope({
      ...valid,
      action: {
        ...valid.action,
        request: {
          ...valid.action.request,
          submission: { preview: 'image', parts: [{ type: 'image', mediaType: 'image/png', data: 'not base64' }] },
        },
      },
    })).toBeUndefined()
  })

  it('rejects invalid limits', () => {
    expect(parseActionEnvelope({
      ...valid,
      action: { ...valid.action, request: { ...valid.action.request, options: { count: 21, usePlanner: false, concurrency: 2 } } },
    })).toBeUndefined()
  })
})
