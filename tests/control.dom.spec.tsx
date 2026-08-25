// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultiVersionControl } from '../src/client/MultiVersionControl.tsx'
import { MultiVersionInputController } from '../src/client/input-adapter.ts'
import type { StartRunRequest } from '../src/core/types.ts'

const submission = { preview: 'question', parts: [{ type: 'text' as const, text: 'question' }] }

afterEach(cleanup)

describe('MultiVersionControl', () => {
  it('renders the official-seat control shape and disables Start without the adapter', () => {
    const { container } = render(<MultiVersionControl sessionId="session-1" hasSubmission />)
    expect(container.querySelector('[data-dsh-plugin="multi-version"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '多版本' }))
    expect((screen.getByRole('button', { name: '开始生成' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('当前 DSH 缺少兼容的原子富输入服务')).toBeTruthy()
  })

  it('warns when Host admitted the run but a newer composer draft was preserved', async () => {
    const controller = new MultiVersionInputController({
      prepare: async () => ({ submission, commit: () => false, rollback: () => {} }),
    }, { start: async () => ({ runId: 'run-preserved' }) })
    render(<MultiVersionControl sessionId="session-1" hasSubmission controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: '多版本' }))
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('新草稿已保留'))
  })

  it('submits the selected count and planner mode through the adapter controller', async () => {
    const start = vi.fn(async (_request: StartRunRequest) => ({ runId: 'run-9' }))
    const controller = new MultiVersionInputController({
      prepare: async () => ({ submission, commit: () => true, rollback: () => {} }),
    }, { start })
    render(<MultiVersionControl sessionId="session-1" hasSubmission controller={controller} />)

    fireEvent.click(screen.getByRole('button', { name: '多版本' }))
    fireEvent.change(screen.getByLabelText('版本数量'), { target: { value: '4' } })
    fireEvent.click(screen.getByLabelText('使用规划器'))
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    expect(start.mock.calls[0]![0].options).toEqual({ count: 4, usePlanner: false, concurrency: 3 })
  })
})
