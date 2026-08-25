import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, opendir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { validateRunOptions } from './core/invariant.ts'
import type { RunPhase, RunRecord, VersionPhase, VersionRecord } from './core/types.ts'

const ACTIVE_PHASES = new Set<RunPhase>(['preparing', 'planning', 'running'])
const RUN_PHASES = new Set<RunPhase>(['preparing', 'planning', 'running', 'completed', 'failed', 'cancelled', 'interrupted'])
const VERSION_PHASES = new Set<VersionPhase>(['pending', 'running', 'completed', 'failed', 'cancelled'])

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function optionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function decodeVersion(value: unknown, expectedIndex: number): VersionRecord | undefined {
  const input = object(value)
  if (input === undefined) return undefined
  const expectedId = `version-${String(expectedIndex).padStart(2, '0')}`
  if (input.id !== expectedId || input.index !== expectedIndex || typeof input.phase !== 'string' || !VERSION_PHASES.has(input.phase as VersionPhase)) return undefined
  if (input.relativeDirectory !== join('versions', expectedId)) return undefined
  if (!optionalString(input.title) || !optionalString(input.introduction) || !optionalString(input.startedAt) || !optionalString(input.finishedAt) || !optionalString(input.error)) return undefined
  if (!optionalNonNegativeNumber(input.durationMs)) return undefined
  return input as unknown as VersionRecord
}

function decodeRunRecord(value: unknown, expectedId: string): RunRecord | undefined {
  const input = object(value)
  if (input === undefined || input.schemaVersion !== 1 || input.id !== expectedId) return undefined
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) return undefined
  if (typeof input.sessionId !== 'string' || typeof input.sourceWorkspace !== 'string' || typeof input.runDirectory !== 'string') return undefined
  if (typeof input.phase !== 'string' || !RUN_PHASES.has(input.phase as RunPhase)) return undefined
  if (typeof input.createdAt !== 'string' || typeof input.updatedAt !== 'string' || typeof input.promptPreview !== 'string') return undefined
  if (!optionalString(input.error)) return undefined
  if (!Array.isArray(input.warnings) || !input.warnings.every(warning => typeof warning === 'string')) return undefined
  const options = object(input.options)
  if (options === undefined) return undefined
  try {
    validateRunOptions(options as unknown as RunRecord['options'])
  } catch {
    return undefined
  }
  if (!Array.isArray(input.versions) || input.versions.length !== options.count) return undefined
  const versions = input.versions.map((version, index) => decodeVersion(version, index + 1))
  if (versions.some(version => version === undefined)) return undefined
  return { ...input, options, versions } as unknown as RunRecord
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(content, { encoding: 'utf8' })
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeTextAtomic(path: string, value: string): Promise<void> {
  await atomicWrite(path, value)
}

/** Per-run serialized, Host-authoritative ledger backed by run.json files. */
export class RunLedger {
  private readonly records = new Map<string, RunRecord>()
  private readonly queues = new Map<string, Promise<void>>()

  constructor(private readonly rootDirectory: string, private readonly now: () => Date) {}

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 })
    const stats = await lstat(this.rootDirectory)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('ledger root must be a real directory')
  }

  private runDirectory(runId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) throw new Error('run id is not a safe directory name')
    return join(this.rootDirectory, runId)
  }

  private assertOwnedPath(record: RunRecord): void {
    if (resolve(record.runDirectory) !== resolve(this.runDirectory(record.id))) throw new Error('run record points outside its Host-owned directory')
  }

  private async ensureRunDirectory(runId: string): Promise<string> {
    const directory = this.runDirectory(runId)
    const stats = await lstat(directory)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('run directory must remain a real Host-owned directory')
    return directory
  }

  snapshot(): readonly RunRecord[] {
    return [...this.records.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  get(runId: string): RunRecord | undefined {
    return this.records.get(runId)
  }

  async load(): Promise<void> {
    await this.ensureRoot()
    const directory = await opendir(this.rootDirectory)
    for await (const entry of directory) {
      if (!entry.isDirectory()) continue
      const runPath = join(this.rootDirectory, entry.name, 'run.json')
      try {
        const parsed = decodeRunRecord(JSON.parse(await readFile(runPath, 'utf8')), entry.name)
        if (parsed === undefined) throw new Error('run record shape is invalid')
        this.assertOwnedPath(parsed)
        this.records.set(parsed.id, parsed)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          try {
            const orphan = this.runDirectory(entry.name)
            const stats = await lstat(orphan)
            if (!stats.isSymbolicLink() && stats.isDirectory()) await rm(orphan, { recursive: true, force: true })
          } catch {
            // A concurrently removed or unsafe entry is left untouched.
          }
          continue
        }
        const stamp = this.now().toISOString().replace(/[:.]/g, '-')
        await rename(runPath, join(this.rootDirectory, entry.name, `run.corrupt-${stamp}.json`)).catch(() => {})
        await writeTextAtomic(join(this.rootDirectory, entry.name, 'run.corrupt.txt'), String(error))
      }
    }
  }

  async recoverInterrupted(): Promise<readonly RunRecord[]> {
    const recovered: RunRecord[] = []
    for (const record of this.snapshot()) {
      if (!ACTIVE_PHASES.has(record.phase)) continue
      recovered.push(await this.update(record.id, current => ({
        ...current,
        phase: 'interrupted',
        warnings: [...current.warnings, 'Host restarted before this run reached a terminal state.'],
        versions: current.versions.map(version => {
          if (version.phase === 'running') {
            return { ...version, phase: 'failed', error: 'Host restarted while the candidate was running.' }
          }
          if (version.phase === 'pending') {
            return { ...version, phase: 'failed', error: 'Host restarted before this candidate started.' }
          }
          return version
        }),
      })))
    }
    return recovered
  }

  async create(record: RunRecord): Promise<void> {
    await this.ensureRoot()
    if (this.records.has(record.id)) throw new Error(`run already exists: ${record.id}`)
    this.assertOwnedPath(record)
    const directory = await this.ensureRunDirectory(record.id)
    this.records.set(record.id, record)
    try {
      await writeJsonAtomic(join(directory, 'run.json'), record)
    } catch (error) {
      this.records.delete(record.id)
      throw error
    }
  }

  async update(runId: string, mutate: (current: RunRecord) => RunRecord): Promise<RunRecord> {
    let output: RunRecord | undefined
    const previous = this.queues.get(runId) ?? Promise.resolve()
    const currentQueue = previous.then(async () => {
      const current = this.records.get(runId)
      if (current === undefined) throw new Error(`unknown run: ${runId}`)
      const proposed = mutate(current)
      const next: RunRecord = {
        ...proposed,
        schemaVersion: 1,
        id: current.id,
        runDirectory: current.runDirectory,
        revision: current.revision + 1,
        updatedAt: this.now().toISOString(),
      }
      this.assertOwnedPath(next)
      const directory = await this.ensureRunDirectory(next.id)
      await writeJsonAtomic(join(directory, 'run.json'), next)
      this.records.set(runId, next)
      output = next
    })
    this.queues.set(runId, currentQueue)
    try {
      await currentQueue
      return output!
    } finally {
      if (this.queues.get(runId) === currentQueue) this.queues.delete(runId)
    }
  }
}
