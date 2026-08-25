import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeWorkspace, prepareRunDirectory } from '../src/workspace-snapshot.ts'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-multi-version-'))
  roots.push(root)
  await mkdir(join(root, 'project'))
  return join(root, 'project')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('materializeWorkspace', () => {
  it('copies one base and clones every candidate from the same snapshot', async () => {
    const source = await workspace()
    await writeFile(join(source, 'tracked.txt'), 'before')
    await writeFile(join(source, '.hidden'), 'hidden')
    await mkdir(join(source, '.git'))
    await writeFile(join(source, '.git', 'config'), 'secret metadata')
    await mkdir(join(source, '.multi-version'))
    await writeFile(join(source, '.multi-version', 'old.txt'), 'old run')

    const layout = await materializeWorkspace(source, join(source, '.multi-version', 'run-1'), 2)
    await writeFile(join(source, 'tracked.txt'), 'after')
    await writeFile(join(layout.versionWorkspaces[0]!, 'tracked.txt'), 'candidate one')

    expect(await readFile(join(layout.baseSnapshot, 'tracked.txt'), 'utf8')).toBe('before')
    expect(await readFile(join(layout.versionWorkspaces[1]!, 'tracked.txt'), 'utf8')).toBe('before')
    expect(await readFile(join(layout.versionWorkspaces[0]!, '.hidden'), 'utf8')).toBe('hidden')
    await expect(readFile(join(layout.baseSnapshot, '.git', 'config'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(layout.baseSnapshot, '.multi-version', 'old.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(source, 'tracked.txt'), 'utf8')).toBe('after')
  })

  it('applies safe root-relative .multiversionignore prefixes', async () => {
    const source = await workspace()
    await mkdir(join(source, 'private'))
    await writeFile(join(source, 'private', 'token.txt'), 'not copied')
    await writeFile(join(source, 'public.txt'), 'copied')
    await writeFile(join(source, '.multiversionignore'), '# local exclusions\nprivate/\n')

    const layout = await materializeWorkspace(source, join(source, '.multi-version', 'run-2'), 1)
    await expect(readFile(join(layout.baseSnapshot, 'private', 'token.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(layout.versionWorkspaces[0]!, 'public.txt'), 'utf8')).toBe('copied')
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked .multi-version output root', async () => {
    const source = await workspace()
    const outside = join(source, '..', 'outside-runs')
    await mkdir(outside)
    await symlink(outside, join(source, '.multi-version'))

    await expect(prepareRunDirectory(source, 'run-escape')).rejects.toThrow('must be a real directory')
    await expect(readFile(join(outside, 'run-escape', 'run.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')('rejects symlinks escaping the source workspace', async () => {
    const source = await workspace()
    await writeFile(join(source, '..', 'outside.txt'), 'outside')
    await symlink('../outside.txt', join(source, 'escape.txt'))

    await expect(materializeWorkspace(source, join(source, '.multi-version', 'run-3'), 1))
      .rejects.toThrow('symlink escapes the workspace')
    await expect(readFile(join(source, '.multi-version', 'run-3', 'base-snapshot', 'escape.txt'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
