import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, opendir, readFile, readlink, realpath, rm, symlink, chmod, utimes } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { versionId } from './core/invariant.ts'

const ALWAYS_EXCLUDED = new Set([
  '.git',
  '.multi-version',
  'node_modules',
  '.pnpm-store',
  '.cache',
  '.next',
  'dist',
  'build',
  'coverage',
])

export interface WorkspaceLayout {
  readonly runDirectory: string
  readonly baseSnapshot: string
  readonly plannerWorkspace?: string
  readonly versionWorkspaces: readonly string[]
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function ensureOutputRoot(sourceRoot: string): Promise<string> {
  const outputRoot = join(sourceRoot, '.multi-version')
  try {
    const stats = await lstat(outputRoot)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('workspace .multi-version root must be a real directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(outputRoot, { recursive: false, mode: 0o700 })
  }
  if (await realpath(outputRoot) !== outputRoot) throw new Error('workspace .multi-version root must not redirect outside the workspace')
  return outputRoot
}

function safeDirectRunName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && value !== '.' && value !== '..'
}

/** Create one Host-owned run directory without following a plugin-root symlink. */
export async function prepareRunDirectory(sourceWorkspace: string, runId: string): Promise<string> {
  if (!safeDirectRunName(runId)) throw new Error('run id is not a safe directory name')
  const sourceRoot = await realpath(sourceWorkspace)
  const outputRoot = await ensureOutputRoot(sourceRoot)
  const runDirectory = join(outputRoot, runId)
  await mkdir(runDirectory, { recursive: false, mode: 0o700 })
  return runDirectory
}

function normalizeIgnore(line: string): string | undefined {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return undefined
  const normalized = trimmed.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  if (normalized === '' || normalized.includes('\0') || normalized.split('/').includes('..')) return undefined
  return normalized
}

async function loadIgnorePrefixes(sourceRoot: string): Promise<readonly string[]> {
  try {
    const text = await readFile(join(sourceRoot, '.multiversionignore'), 'utf8')
    return text.split(/\r?\n/).map(normalizeIgnore).filter((value): value is string => value !== undefined)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function ignored(relativePath: string, prefixes: readonly string[]): boolean {
  const normalized = relativePath.replaceAll(sep, '/')
  const segments = normalized.split('/')
  if (segments.some(segment => ALWAYS_EXCLUDED.has(segment))) return true
  return prefixes.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`))
}

async function copyTree(sourceRoot: string, destinationRoot: string, prefixes: readonly string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await mkdir(destinationRoot, { recursive: false })

  const visit = async (sourceDirectory: string, destinationDirectory: string): Promise<void> => {
    signal?.throwIfAborted()
    const directory = await opendir(sourceDirectory)
    for await (const entry of directory) {
      signal?.throwIfAborted()
      const source = join(sourceDirectory, entry.name)
      const relativePath = relative(sourceRoot, source)
      if (ignored(relativePath, prefixes)) continue
      const destination = join(destinationDirectory, entry.name)
      const stats = await lstat(source)
      if (stats.isSymbolicLink()) {
        const target = await readlink(source)
        if (isAbsolute(target)) throw new Error(`absolute symlink is not snapshot-safe: ${relativePath}`)
        const resolvedTarget = resolve(dirname(source), target)
        if (resolvedTarget !== sourceRoot && !inside(sourceRoot, resolvedTarget)) {
          throw new Error(`symlink escapes the workspace: ${relativePath}`)
        }
        await symlink(target, destination)
        continue
      }
      if (stats.isDirectory()) {
        await mkdir(destination, { recursive: false, mode: stats.mode })
        await visit(source, destination)
        await chmod(destination, stats.mode)
        await utimes(destination, stats.atime, stats.mtime)
        continue
      }
      if (!stats.isFile()) throw new Error(`unsupported workspace entry: ${relativePath}`)
      await copyFile(source, destination, constants.COPYFILE_FICLONE)
      await chmod(destination, stats.mode)
      await utimes(destination, stats.atime, stats.mtime)
    }
  }

  await visit(sourceRoot, destinationRoot)
}

/**
 * Materialize one immutable base snapshot, then clone each candidate from that base.
 * No candidate is copied directly from the live source workspace.
 */
export async function materializeWorkspace(sourceWorkspace: string, runDirectory: string, count: number, signal?: AbortSignal, includePlanner = false): Promise<WorkspaceLayout> {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('snapshot count must be a positive integer')
  const requestedSourceRoot = resolve(sourceWorkspace)
  const requestedOutputRoot = resolve(requestedSourceRoot, '.multi-version')
  const requestedTargetRoot = resolve(runDirectory)
  if (!inside(requestedOutputRoot, requestedTargetRoot)) throw new Error('run directory must be below the workspace .multi-version root')
  const runRelative = relative(requestedOutputRoot, requestedTargetRoot)
  if (!safeDirectRunName(runRelative)) throw new Error('run directory must be a direct child of the workspace .multi-version root')
  const sourceRoot = await realpath(sourceWorkspace)
  const outputRoot = await ensureOutputRoot(sourceRoot)
  const targetRoot = join(outputRoot, runRelative)
  try {
    const stats = await lstat(targetRoot)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('run directory must be a real directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(targetRoot, { recursive: false, mode: 0o700 })
  }
  if (await realpath(targetRoot) !== targetRoot) throw new Error('run directory must not redirect outside the workspace')

  const baseSnapshot = join(targetRoot, 'base-snapshot')
  const prefixes = await loadIgnorePrefixes(sourceRoot)
  try {
    await copyTree(sourceRoot, baseSnapshot, prefixes, signal)
    const versionWorkspaces: string[] = []
    for (let index = 1; index <= count; index += 1) {
      const workspace = join(targetRoot, 'versions', versionId(index), 'workspace')
      await mkdir(dirname(workspace), { recursive: true })
      await copyTree(baseSnapshot, workspace, [], signal)
      versionWorkspaces.push(workspace)
    }
    let plannerWorkspace: string | undefined
    if (includePlanner) {
      plannerWorkspace = join(targetRoot, 'planner', 'workspace')
      await mkdir(dirname(plannerWorkspace), { recursive: true })
      await copyTree(baseSnapshot, plannerWorkspace, [], signal)
    }
    return {
      runDirectory: targetRoot,
      baseSnapshot,
      ...(plannerWorkspace === undefined ? {} : { plannerWorkspace }),
      versionWorkspaces,
    }
  } catch (error) {
    await Promise.all([
      rm(baseSnapshot, { recursive: true, force: true }),
      rm(join(targetRoot, 'planner'), { recursive: true, force: true }),
      rm(join(targetRoot, 'versions'), { recursive: true, force: true }),
    ])
    throw error
  }
}
