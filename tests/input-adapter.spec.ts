import { describe, expect, it, vi } from 'vitest'
import { MultiVersionInputController } from '../src/client/input-adapter.ts'
import type { CapturedSubmission, StartRunRequest } from '../src/core/types.ts'

const submission: CapturedSubmission = {
  preview: '同一个问题',
  parts: [
    { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' },
    { type: 'text', text: '同一个问题' },
  ],
}

describe('MultiVersionInputController', () => {
  it('captures once and commits only after Host admission', async () => {
    const events: string[] = []
    const prepare = vi.fn(async () => ({
      submission,
      commit: () => { events.push('commit'); return true },
      rollback: () => { events.push('rollback') },
    }))
    const start = vi.fn(async (request: StartRunRequest) => {
      events.push('host')
      expect(request.submission).toBe(submission)
      return { runId: 'run-1' }
    })
    const controller = new MultiVersionInputController({ prepare }, { start })

    await expect(controller.start('session-1', { count: 3, usePlanner: false, concurrency: 2 }))
      .resolves.toEqual({ runId: 'run-1', composerCommitted: true })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['host', 'commit'])
  })

  it('reports Host success without clearing a newer draft when commit CAS misses', async () => {
    const rollback = vi.fn()
    const controller = new MultiVersionInputController({
      prepare: async () => ({ submission, commit: () => false, rollback }),
    }, {
      start: async () => ({ runId: 'run-2' }),
    })

    await expect(controller.start('session-1', { count: 2, usePlanner: false, concurrency: 1 }))
      .resolves.toEqual({ runId: 'run-2', composerCommitted: false })
    expect(rollback).not.toHaveBeenCalled()
  })

  it('rolls back the prepared composer when Host admission fails', async () => {
    const rollback = vi.fn()
    const controller = new MultiVersionInputController({
      prepare: async () => ({ submission, commit: () => true, rollback }),
    }, {
      start: async () => { throw new Error('Host unavailable') },
    })

    await expect(controller.start('session-1', { count: 2, usePlanner: true, concurrency: 1 }))
      .rejects.toThrow('Host unavailable')
    expect(rollback).toHaveBeenCalledTimes(1)
  })
})
