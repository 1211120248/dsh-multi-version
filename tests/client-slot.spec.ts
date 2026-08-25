import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const clientEntry = new URL('../src/client/index.ts', import.meta.url)

describe('client slot contract', () => {
  it('keeps run history in the Chat transcript and out of composer docks', async () => {
    const source = await readFile(clientEntry, 'utf8')

    expect(source).toContain("ctx.slots.inject('conversation.chat.commandview'")
    expect(source).toContain("ctx.slots.inject('conversation.chat.node'")
    expect(source).toContain("key: 'multi-version-run'")
    expect(source).not.toContain("ctx.slots.inject('conversation.input.dock'")
    expect(source).not.toContain("ctx.slots.inject('conversation.composer.dock'")
  })
})
