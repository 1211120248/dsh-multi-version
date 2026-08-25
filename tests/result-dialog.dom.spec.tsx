// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResultDialog } from '../src/client/ResultDialog.tsx'

afterEach(cleanup)

describe('ResultDialog', () => {
  it('shows the full response as plain text and closes without interpreting HTML', () => {
    const close = vi.fn()
    const markdown = '# Result\n\n<script>window.compromised = true</script>'
    render(<ResultDialog title="Version 1" loading={false} markdown={markdown} onClose={close} />)

    expect(screen.getByRole('dialog', { name: 'Version 1' })).toBeTruthy()
    expect(document.querySelector('[data-dsh-part="result-content"]')?.textContent).toBe(markdown)
    expect(document.querySelector('script')).toBeNull()
    fireEvent.click(screen.getByText('关闭', { selector: 'button' }))
    expect(close).toHaveBeenCalledOnce()
  })
})
