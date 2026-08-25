import { describe, expect, it, vi } from 'vitest'
import { DshConversationInputAdapter } from '../src/client/dsh-client.ts'

function compatibleComposer() {
  const state = {
    draft: 'Look @file now',
    draftRev: 7,
    imageIds: ['image-1'] as string[],
    occurrences: [{ source: 'file', ref: '/a.txt', offset: 5, length: 5, invalid: undefined as boolean | undefined }],
    phase: 'plain',
  }
  const commitSend = vi.fn((imageIds: readonly string[]) => {
    state.draft = ''
    state.draftRev += 1
    state.imageIds = state.imageIds.filter(id => !imageIds.includes(id))
    state.occurrences = []
  })
  const input = {
    state: { getSnapshot: () => ({ ...state, imageIds: [...state.imageIds], occurrences: [...state.occurrences] }) },
    commitSend,
  }
  const attachments = [{ id: 'attachment-1' }]
  const releaseDraftImages = vi.fn()
  const conversation = {
    input: { for: vi.fn(() => input) },
    serializeDraftImages: vi.fn(async () => [{ mediaType: 'image/png', data: 'aGVsbG8=', name: 'a.png' }]),
    draftImages: vi.fn(() => attachments),
    releaseDraftImages,
  }
  const scope = { get: vi.fn((name: string) => name === 'conversation' ? conversation : undefined) }
  const sessions = { scope: vi.fn(() => scope) }
  const serializeReference = vi.fn(async (source: string, ref: string) => `<${source}:${ref}>`)
  const inputTriggers = { sessionOf: vi.fn(() => ({ serializeReference })) }
  const adapter = new DshConversationInputAdapter(sessions as never, inputTriggers as never)
  return { adapter, state, commitSend, releaseDraftImages, attachments, serializeReference }
}

describe('DshConversationInputAdapter compatibility lease', () => {
  it('captures text, references, and images once, then atomically commits the captured draft', async () => {
    const bench = compatibleComposer()
    expect(bench.adapter.supports('session-1')).toBe(true)
    const prepared = await bench.adapter.prepare('session-1')

    expect(prepared?.submission).toEqual({
      preview: 'Look @file now',
      parts: [
        { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name: 'a.png' },
        { type: 'text', text: 'Look <file:/a.txt> now' },
      ],
    })
    expect(bench.serializeReference).toHaveBeenCalledWith('file', '/a.txt', expect.any(AbortSignal))
    expect(prepared?.commit()).toBe(true)
    expect(bench.commitSend).toHaveBeenCalledWith(['image-1'])
    expect(bench.releaseDraftImages).toHaveBeenCalledWith(bench.attachments)
    expect(bench.state.draft).toBe('')
  })

  it('preserves a newer draft when the compare-and-swap revision changed', async () => {
    const bench = compatibleComposer()
    const prepared = await bench.adapter.prepare('session-1')
    bench.state.draft = 'new draft'
    bench.state.draftRev += 1

    expect(prepared?.commit()).toBe(false)
    expect(bench.commitSend).not.toHaveBeenCalled()
    expect(bench.releaseDraftImages).not.toHaveBeenCalled()
    expect(bench.state.draft).toBe('new draft')
  })

  it('fails closed for an unresolved reference and releases the preparation lock', async () => {
    const bench = compatibleComposer()
    bench.state.occurrences[0]!.invalid = true
    await expect(bench.adapter.prepare('session-1')).rejects.toThrow('unresolved reference')

    bench.state.occurrences[0]!.invalid = false
    const prepared = await bench.adapter.prepare('session-1')
    expect(prepared).not.toBeNull()
    prepared?.rollback()
  })

  it('makes rollback idempotent and leaves composer state untouched', async () => {
    const bench = compatibleComposer()
    const prepared = await bench.adapter.prepare('session-1')

    prepared?.rollback()
    prepared?.rollback()
    expect(bench.commitSend).not.toHaveBeenCalled()
    expect(bench.releaseDraftImages).not.toHaveBeenCalled()
    expect(bench.state.draft).toBe('Look @file now')
  })
})
