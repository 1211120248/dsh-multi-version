// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultiVersionRunNode, type MultiVersionRunNodeProps } from '../src/client/MultiVersionRunNode.tsx'
import { zh } from '../src/client/locales.ts'
import type { RunsView } from '../src/client/run-controller.ts'

const view: RunsView = {
  status: 'ready',
  runs: [{
    schemaVersion: 1,
    revision: 3,
    id: 'run-target',
    sessionId: 'session-1',
    phase: 'running',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:01.000Z',
    options: { count: 2, usePlanner: false, concurrency: 2 },
    promptPreview: '目标运行',
    warnings: [],
    versions: [
      { id: 'version-01', index: 1, phase: 'running' },
      { id: 'version-02', index: 2, phase: 'pending' },
    ],
  }, {
    schemaVersion: 1,
    revision: 1,
    id: 'run-other',
    sessionId: 'session-1',
    phase: 'completed',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:01.000Z',
    options: { count: 1, usePlanner: false, concurrency: 1 },
    promptPreview: '不应显示的运行',
    warnings: [],
    versions: [{ id: 'version-01', index: 1, phase: 'completed' }],
  }],
}

afterEach(cleanup)

describe('MultiVersionRunNode', () => {
  it('renders the command-addressed run as one transcript node', async () => {
    const ensure = vi.fn(async () => {})
    const props = {
      node: { data: { runId: 'run-target' } },
      useRuns: <Selected,>(selector: (state: RunsView) => Selected): Selected => selector(view),
      ensure,
      cancel: vi.fn(async () => {}),
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as MultiVersionRunNodeProps

    const { container } = render(<MultiVersionRunNode {...props} />)
    expect(container.querySelector('[data-dsh-part="run-node"]')).not.toBeNull()
    expect(screen.getByText('目标运行')).toBeTruthy()
    expect(screen.queryByText('不应显示的运行')).toBeNull()
    await waitFor(() => { expect(ensure).toHaveBeenCalledTimes(1) })
  })
})
