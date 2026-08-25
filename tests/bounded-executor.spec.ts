import { describe, expect, it } from 'vitest'
import { runBounded } from '../src/core/bounded-executor.ts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('runBounded', () => {
  it('never exceeds the configured concurrency and preserves order', async () => {
    let active = 0
    let maximum = 0
    const gates = Array.from({ length: 5 }, deferred)
    const controller = new AbortController()
    const pending = runBounded([1, 2, 3, 4, 5], 2, async (value, index) => {
      active += 1
      maximum = Math.max(maximum, active)
      await gates[index]!.promise
      active -= 1
      return value * 10
    }, controller.signal)

    await Promise.resolve()
    expect(maximum).toBe(2)
    gates[0]!.resolve()
    gates[1]!.resolve()
    await Promise.resolve()
    await Promise.resolve()
    gates[2]!.resolve()
    gates[3]!.resolve()
    await Promise.resolve()
    await Promise.resolve()
    gates[4]!.resolve()

    const result = await pending
    expect(maximum).toBe(2)
    expect(result.map(item => item.value)).toEqual([10, 20, 30, 40, 50])
  })

  it('does not start queued work after cancellation', async () => {
    const gate = deferred()
    const controller = new AbortController()
    const started: number[] = []
    const pending = runBounded([1, 2, 3], 1, async (value) => {
      started.push(value)
      await gate.promise
      return value
    }, controller.signal)
    await Promise.resolve()
    controller.abort(new Error('cancelled'))
    gate.resolve()
    const result = await pending

    expect(started).toEqual([1])
    expect(result.map(item => item.status)).toEqual(['fulfilled', 'rejected', 'rejected'])
  })
})
