import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunCoordinator } from '../src/run-coordinator.ts'
import { writeJsonAtomic, writeTextAtomic } from '../src/run-ledger.ts'
import { WorkspaceUnavailableError } from '../src/core/types.ts'
import type { CandidateExecutionRequest, CapturedSubmission, RuntimeSources, VersionPlannerRequest } from '../src/core/types.ts'

const roots: string[] = []

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-multi-run-'))
  roots.push(workspace)
  await writeFile(join(workspace, 'source.txt'), 'same snapshot')
  return workspace
}

function sources(): RuntimeSources {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 7, 21, 0, 0, tick++)),
    randomId: () => 'abc123',
  }
}

const submission: CapturedSubmission = {
  preview: 'current rich question',
  parts: [
    { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' },
    { type: 'text', text: 'current rich question' },
  ],
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('RunCoordinator', () => {
  it('uses one snapshot, distinct cwd values, bounded concurrency, and no review call', async () => {
    const workspace = await createWorkspace()
    let active = 0
    let maximum = 0
    let releaseFirstPair!: () => void
    const firstPairStarted = new Promise<void>(resolve => { releaseFirstPair = resolve })
    let verifiedAllCopies = false
    const requests: CandidateExecutionRequest[] = []
    const planner = { plan: vi.fn(async (request: VersionPlannerRequest) => Array.from({ length: request.requestedCount }, (_, index) => ({
      title: `方向 ${index + 1}`,
      description: `介绍 ${index + 1}`,
      instruction: `执行方向 ${index + 1}`,
    }))) }
    const executor = {
      execute: vi.fn(async (request: CandidateExecutionRequest) => {
        requests.push(request)
        active += 1
        maximum = Math.max(maximum, active)
        if (!verifiedAllCopies) {
          const versionsRoot = dirname(dirname(request.cwd))
          await Promise.all([1, 2, 3, 4].map(index => access(join(versionsRoot, `version-0${index}`, 'workspace', 'source.txt'))))
          verifiedAllCopies = true
        }
        expect(await readFile(join(request.cwd, 'source.txt'), 'utf8')).toBe('same snapshot')
        if (active === 2) releaseFirstPair()
        await firstPairStarted
        await writeFile(join(request.cwd, 'candidate.txt'), request.versionId)
        active -= 1
        return { markdown: `# ${request.versionId}\n\nCandidate output.`, raw: { version: request.versionId } }
      }),
    }
    const coordinator = new RunCoordinator({
      workspaceResolver: { resolve: async () => workspace },
      planner,
      executor,
      sources: sources(),
    })

    const runId = await coordinator.start({
      sessionId: 'session-1',
      submission,
      options: { count: 4, usePlanner: true, concurrency: 2 },
    })
    await coordinator.wait(runId)

    const run = coordinator.snapshot().find(candidate => candidate.id === runId)
    expect(run?.phase).toBe('completed')
    expect(run?.versions.map(version => version.phase)).toEqual(['completed', 'completed', 'completed', 'completed'])
    expect(planner.plan).toHaveBeenCalledTimes(1)
    const plannerRequest = planner.plan.mock.calls[0]![0]
    expect(plannerRequest.sessionId).toBe('session-1')
    expect(plannerRequest.cwd).toBe(join(run!.runDirectory, 'planner', 'workspace'))
    expect(executor.execute).toHaveBeenCalledTimes(4)
    expect(maximum).toBe(2)
    expect(new Set(requests.map(request => request.cwd)).size).toBe(4)
    expect(requests.map(request => request.brief?.title)).toEqual(['方向 1', '方向 2', '方向 3', '方向 4'])
    expect(await readFile(join(run!.runDirectory, 'SUMMARY.md'), 'utf8')).toContain('方向 1')
  })

  it('fails planner mode before candidates when briefs are not distinct', async () => {
    const workspace = await createWorkspace()
    const execute = vi.fn()
    const coordinator = new RunCoordinator({
      workspaceResolver: { resolve: async () => workspace },
      planner: {
        plan: async request => Array.from({ length: request.requestedCount }, () => ({
          title: 'same', description: 'same', instruction: 'same',
        })),
      },
      executor: { execute },
      sources: sources(),
    })
    const runId = await coordinator.start({
      sessionId: 'session-1',
      submission,
      options: { count: 2, usePlanner: true, concurrency: 2 },
    })
    await coordinator.wait(runId)
    const run = coordinator.snapshot().find(candidate => candidate.id === runId)!
    expect(run.phase).toBe('failed')
    expect(run.error).toContain('duplicates an earlier direction')
    expect(JSON.parse(await readFile(join(run.runDirectory, 'index.json'), 'utf8'))).toMatchObject({ phase: 'failed' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('cancels active work and never starts queued candidates', async () => {
    const workspace = await createWorkspace()
    let startedResolve!: () => void
    const started = new Promise<void>(resolve => { startedResolve = resolve })
    const execute = vi.fn(async (_request: CandidateExecutionRequest, signal: AbortSignal) => {
      startedResolve()
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      throw new Error('unreachable')
    })
    const coordinator = new RunCoordinator({
      workspaceResolver: { resolve: async () => workspace },
      executor: { execute },
      sources: sources(),
    })
    const runId = await coordinator.start({
      sessionId: 'session-1',
      submission,
      options: { count: 3, usePlanner: false, concurrency: 1 },
    })
    await started
    expect(coordinator.cancel('session-2', runId)).toBe(false)
    expect(coordinator.cancel('session-1', runId)).toBe(true)
    await coordinator.wait(runId)

    const run = coordinator.snapshot().find(candidate => candidate.id === runId)!
    expect(execute).toHaveBeenCalledTimes(1)
    expect(run.phase).toBe('cancelled')
    expect(run.versions.map(version => version.phase)).toEqual(['cancelled', 'cancelled', 'cancelled'])
  })

  it('returns no runs while a new session has no Host workspace yet', async () => {
    const coordinator = new RunCoordinator({
      workspaceResolver: {
        resolve: async () => { throw new WorkspaceUnavailableError('workspace not materialized') },
      },
      executor: { execute: vi.fn() },
      sources: sources(),
    })

    await expect(coordinator.runsForSession('session-new')).resolves.toEqual([])
  })

  it('recovers interrupted records and regenerates both navigation files', async () => {
    const workspace = await createWorkspace()
    const resolvedWorkspace = await realpath(workspace)
    const runId = 'run-recover'
    const runDirectory = join(resolvedWorkspace, '.multi-version', runId)
    await mkdir(runDirectory, { recursive: true })
    await writeFile(join(runDirectory, 'run.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 0,
      id: runId,
      sessionId: 'session-1',
      sourceWorkspace: resolvedWorkspace,
      runDirectory,
      phase: 'running',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      options: { count: 2, usePlanner: false, concurrency: 1 },
      promptPreview: 'recover me',
      warnings: [],
      versions: [
        { id: 'version-01', index: 1, phase: 'running', relativeDirectory: 'versions/version-01' },
        { id: 'version-02', index: 2, phase: 'pending', relativeDirectory: 'versions/version-02' },
      ],
    }))
    const coordinator = new RunCoordinator({
      workspaceResolver: { resolve: async () => workspace },
      executor: { execute: vi.fn() },
      sources: sources(),
    })

    const runs = await coordinator.runsForSession('session-1')

    expect(runs[0]?.phase).toBe('interrupted')
    expect(runs[0]?.versions.map(version => version.phase)).toEqual(['failed', 'failed'])
    expect(await readFile(join(runDirectory, 'SUMMARY.md'), 'utf8')).toContain('interrupted')
    expect(JSON.parse(await readFile(join(runDirectory, 'index.json'), 'utf8'))).toMatchObject({
      id: runId,
      phase: 'interrupted',
    })
  })

  it.skipIf(process.platform === 'win32')('keeps request evidence when snapshot preparation fails', async () => {
    const workspace = await createWorkspace()
    const outside = `${workspace}-outside-evidence.txt`
    roots.push(outside)
    await writeFile(outside, 'outside')
    await symlink(outside, join(workspace, 'escape.txt'))
    const execute = vi.fn()
    const coordinator = new RunCoordinator({
      workspaceResolver: { resolve: async () => workspace },
      executor: { execute },
      sources: sources(),
    })

    const runId = await coordinator.start({
      sessionId: 'session-1',
      submission,
      options: { count: 2, usePlanner: false, concurrency: 1 },
    })
    await coordinator.wait(runId)
    const run = coordinator.snapshot().find(candidate => candidate.id === runId)!

    expect(run.phase).toBe('failed')
    expect(execute).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(run.runDirectory, 'request.json'), 'utf8')).sessionId).toBe('session-1')
  })

  it('removes the unadmitted run directory when request persistence fails', async () => {
    const workspace = await createWorkspace()
    const coordinator = new RunCoordinator({
      workspaceResolver: { resolve: async () => workspace },
      executor: { execute: vi.fn() },
      sources: sources(),
      persistence: {
        writeJson: async path => {
          if (path.endsWith('request.json')) throw new Error('request storage unavailable')
          await writeJsonAtomic(path, {})
        },
        writeText: writeTextAtomic,
      },
    })

    await expect(coordinator.start({
      sessionId: 'session-1',
      submission,
      options: { count: 2, usePlanner: false, concurrency: 1 },
    })).rejects.toThrow('request storage unavailable')

    expect(coordinator.snapshot()).toEqual([])
    expect(await readdir(join(workspace, '.multi-version'))).toEqual([])
  })

  it('fails the run when candidate status persistence rejects outside candidate settlement', async () => {
    const workspace = await createWorkspace()
    let rejectFirstStatus = true
    const coordinator = new RunCoordinator({
      workspaceResolver: { resolve: async () => workspace },
      executor: { execute: async () => { throw new Error('candidate failed') } },
      sources: sources(),
      persistence: {
        writeJson: async (path, value) => {
          if (rejectFirstStatus && path.endsWith('status.json')) {
            rejectFirstStatus = false
            throw new Error('status storage unavailable')
          }
          await writeJsonAtomic(path, value)
        },
        writeText: writeTextAtomic,
      },
    })

    const runId = await coordinator.start({
      sessionId: 'session-1',
      submission,
      options: { count: 2, usePlanner: false, concurrency: 1 },
    })
    await coordinator.wait(runId)

    const run = coordinator.snapshot().find(candidate => candidate.id === runId)!
    expect(run.phase).toBe('failed')
    expect(run.error).toContain('candidate infrastructure failed')
    expect(run.error).toContain('status storage unavailable')
    expect(run.versions.map(version => version.phase)).toEqual(['failed', 'failed'])
  })

  it('passes the exact same captured submission to every candidate when planner is off', async () => {
    const workspace = await createWorkspace()
    const seen: CapturedSubmission[] = []
    const coordinator = new RunCoordinator({
      workspaceResolver: { resolve: async () => workspace },
      executor: {
        execute: async (request) => {
          seen.push(request.submission)
          return { markdown: '# Result\n\nDone.', raw: { ok: true } }
        },
      },
      sources: sources(),
    })

    const runId = await coordinator.start({
      sessionId: 'session-1',
      submission,
      options: { count: 3, usePlanner: false, concurrency: 3 },
    })
    await coordinator.wait(runId)

    expect(seen).toHaveLength(3)
    expect(seen.every(candidate => candidate === submission)).toBe(true)
    const run = coordinator.snapshot().find(candidate => candidate.id === runId)!
    expect(run.warnings).toEqual([])
    await expect(readFile(join(run.runDirectory, 'planner.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
