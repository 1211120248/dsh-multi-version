import { describe, expect, it } from 'vitest'
import { multiVersionRunDefinition } from '../src/client/run-definition.ts'

const runId = '20260824T170537Z-7c93232aeb0c'
const startEvent = {
  type: 'command/run',
  seq: 4,
  time: 1,
  data: {
    commandId: `multi-version:${runId}`,
    name: 'multi-version',
    args: runId,
    source: { kind: 'user' },
  },
}

describe('multiVersionRunDefinition', () => {
  it('projects the persistence-safe command lifecycle into a non-command Chat node', () => {
    const identity = multiVersionRunDefinition.match(startEvent as never)
    expect(identity).toEqual({ id: runId, role: 'start' })

    const match = { event: startEvent, location: { kind: 'unresolved' } }
    const state = multiVersionRunDefinition.start({} as never, match as never, {} as never)
    const node = multiVersionRunDefinition.buildViewNode?.({
      key: `17:multi-version-run${runId}`,
      id: runId,
      state,
      start: match,
      matches: [match],
    } as never)

    expect(node).toMatchObject({
      kind: 'multi-version-run',
      id: runId,
      target: 'chat',
      anchorSeq: 4,
      visibility: 'visible',
      data: { runId },
    })
  })

  it('ignores unrelated command names', () => {
    expect(multiVersionRunDefinition.match({
      ...startEvent,
      data: { ...startEvent.data, name: 'other' },
    } as never)).toBeNull()
  })
})
