import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const stylesheet = new URL('../src/client/multi-version.module.css', import.meta.url)

describe('multi-version theme contract', () => {
  it('uses official DSH skin tokens instead of light-mode fallbacks', async () => {
    const css = await readFile(stylesheet, 'utf8')

    expect(css).toContain('background: var(--dsw-alias-bg-module-platform)')
    expect(css).toContain('background: var(--dsw-alias-markdown-code-block)')
    expect(css).not.toContain('--dsh-color-')
    expect(css).not.toContain('#fff')
  })
})
