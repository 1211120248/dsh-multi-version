// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunSummaryPanel } from '../src/client/RunSummaryPanel.tsx'
import type { RunView } from '../src/core/types.ts'

afterEach(cleanup)

const run: RunView = {
  schemaVersion: 1,
  revision: 5,
  id: 'run-1',
  sessionId: 'session-1',
  phase: 'completed',
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:01:00.000Z',
  options: { count: 2, usePlanner: true, concurrency: 2 },
  promptPreview: '实现登录功能',
  warnings: [],
  versions: [
    { id: 'version-01', index: 1, phase: 'completed', title: '本地登录', introduction: '账号密码实现。' },
    { id: 'version-02', index: 2, phase: 'completed', title: 'OAuth', introduction: '第三方授权实现。' },
  ],
}

describe('RunSummaryPanel', () => {
  it('presents all versions in one compact transcript summary without ranking', () => {
    const open = vi.fn()
    const { container } = render(<RunSummaryPanel run={run} onOpenResult={open} />)
    expect(container.querySelector('[data-dsh-part="run-summary"]')).not.toBeNull()
    expect(screen.getByText('本地登录')).toBeTruthy()
    expect(screen.getByText('第三方授权实现。')).toBeTruthy()
    expect(screen.queryByText('最佳版本')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '查看完整结果' })[1]!)
    expect(open).toHaveBeenCalledWith('run-1', 'version-02', 'OAuth')
  })
})
