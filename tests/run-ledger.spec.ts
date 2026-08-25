import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RunLedger } from '../src/run-ledger.ts'
import type { RunRecord } from '../src/core/types.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('RunLedger recovery', () => {
  it('marks active work interrupted without replaying it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-multi-ledger-'))
    roots.push(root)
    const now = () => new Date('2026-08-21T00:01:00.000Z')
    const ledger = new RunLedger(root, now)
    const record: RunRecord = {
      schemaVersion: 1,
      revision: 0,
      id: 'run-1',
      sessionId: 'session-1',
      sourceWorkspace: dirname(root),
      runDirectory: join(root, 'run-1'),
      phase: 'running',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      options: { count: 2, usePlanner: false, concurrency: 1 },
      promptPreview: 'test',
      warnings: [],
      versions: [
        { id: 'version-01', index: 1, phase: 'running', relativeDirectory: 'versions/version-01' },
        { id: 'version-02', index: 2, phase: 'pending', relativeDirectory: 'versions/version-02' },
      ],
    }
    await mkdir(record.runDirectory)
    await ledger.create(record)

    const restarted = new RunLedger(root, now)
    await restarted.load()
    await restarted.recoverInterrupted()

    const recovered = restarted.get('run-1')!
    expect(recovered.phase).toBe('interrupted')
    expect(recovered.versions[0]).toMatchObject({ phase: 'failed', error: expect.stringContaining('Host restarted') })
    expect(recovered.versions[1]).toMatchObject({ phase: 'failed', error: expect.stringContaining('before this candidate started') })
    expect(recovered.revision).toBe(1)
  })

  it('removes safe orphan run directories that never received run.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-multi-ledger-'))
    roots.push(root)
    const orphan = join(root, 'run-orphan')
    await mkdir(orphan)
    await writeFile(join(orphan, 'request.json'), '{}')
    const ledger = new RunLedger(root, () => new Date('2026-08-21T00:01:00.000Z'))

    await ledger.load()

    await expect(readFile(join(orphan, 'request.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(ledger.snapshot()).toEqual([])
  })

  it('quarantines a record whose persisted runDirectory escapes the ledger root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-multi-ledger-'))
    roots.push(root)
    const outside = join(root, 'outside-target')
    await mkdir(join(root, 'run-evil'))
    const malicious: RunRecord = {
      schemaVersion: 1,
      revision: 0,
      id: 'run-evil',
      sessionId: 'session-1',
      sourceWorkspace: dirname(root),
      runDirectory: outside,
      phase: 'running',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      options: { count: 2, usePlanner: false, concurrency: 1 },
      promptPreview: 'test',
      warnings: [],
      versions: [
        { id: 'version-01', index: 1, phase: 'pending', relativeDirectory: 'versions/version-01' },
        { id: 'version-02', index: 2, phase: 'pending', relativeDirectory: 'versions/version-02' },
      ],
    }
    await writeFile(join(root, 'run-evil', 'run.json'), JSON.stringify(malicious))
    const ledger = new RunLedger(root, () => new Date('2026-08-21T00:01:00.000Z'))
    await ledger.load()
    await ledger.recoverInterrupted()

    expect(ledger.get('run-evil')).toBeUndefined()
    await expect(readFile(join(outside, 'run.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(root, 'run-evil', 'run.corrupt.txt'), 'utf8')).toContain('Host-owned directory')
  })

  it('quarantines malformed records instead of blocking later recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-multi-ledger-'))
    roots.push(root)
    const runDirectory = join(root, 'run-malformed')
    await mkdir(runDirectory)
    await writeFile(join(runDirectory, 'run.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 0,
      id: 'run-malformed',
      sessionId: 'session-1',
      sourceWorkspace: dirname(root),
      runDirectory,
      phase: 'running',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      options: { count: 2, usePlanner: false, concurrency: 1 },
      promptPreview: 'test',
      warnings: null,
      versions: [
        { id: 'version-01', index: 1, phase: 'pending', relativeDirectory: 'versions/version-01' },
        { id: 'version-02', index: 2, phase: 'pending', relativeDirectory: 'versions/version-02' },
      ],
    }))
    const ledger = new RunLedger(root, () => new Date('2026-08-21T00:01:00.000Z'))

    await expect(ledger.load()).resolves.toBeUndefined()
    await expect(ledger.recoverInterrupted()).resolves.toEqual([])
    expect(ledger.get('run-malformed')).toBeUndefined()
    expect(await readFile(join(runDirectory, 'run.corrupt.txt'), 'utf8')).toContain('shape is invalid')
  })
})
