import { readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { runBounded } from './core/bounded-executor.ts'
import { safeRunId, validateBriefs, validateStartRequest, versionId } from './core/invariant.ts'
import { deriveIntroduction, renderSummary } from './core/summary.ts'
import { WorkspaceUnavailableError } from './core/types.ts'
import type {
  CandidateExecutor,
  RunRecord,
  RuntimeSources,
  StartRunRequest,
  VersionBrief,
  VersionPlanner,
  VersionRecord,
  VersionResult,
  WorkspaceResolver,
} from './core/types.ts'
import { RunLedger, writeJsonAtomic, writeTextAtomic } from './run-ledger.ts'
import { materializeWorkspace, prepareRunDirectory } from './workspace-snapshot.ts'

interface ActiveRun {
  readonly controller: AbortController
  readonly settled: Promise<void>
  readonly ledger: RunLedger
}

export type RunRecordPublicationReason = 'started' | 'settled' | 'observed'

export interface RunCoordinatorDependencies {
  readonly workspaceResolver: WorkspaceResolver
  readonly executor: CandidateExecutor
  readonly planner?: VersionPlanner
  readonly sources: RuntimeSources
  /** Durable session-flow bridge. Failures are contained and never veto a run. */
  readonly publish?: (record: RunRecord, reason: RunRecordPublicationReason) => void
  /** Testable persistence seam; production uses the atomic Host writers. */
  readonly persistence?: {
    writeJson(path: string, value: unknown): Promise<void>
    writeText(path: string, value: string): Promise<void>
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function replaceVersion(record: RunRecord, index: number, mutate: (version: VersionRecord) => VersionRecord): RunRecord {
  return { ...record, versions: record.versions.map(version => version.index === index ? mutate(version) : version) }
}

/** Owns snapshots, bounded execution, cancellation, durable results, and local summaries. */
export class RunCoordinator {
  private readonly ledgers = new Map<string, Promise<RunLedger>>()
  private readonly readyLedgers = new Set<RunLedger>()
  private readonly active = new Map<string, ActiveRun>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly dependencies: RunCoordinatorDependencies) {}

  private writeJson(path: string, value: unknown): Promise<void> {
    return this.dependencies.persistence?.writeJson(path, value) ?? writeJsonAtomic(path, value)
  }

  private writeText(path: string, value: string): Promise<void> {
    return this.dependencies.persistence?.writeText(path, value) ?? writeTextAtomic(path, value)
  }

  private publish(record: RunRecord, reason: RunRecordPublicationReason): void {
    try {
      this.dependencies.publish?.(record, reason)
    } catch (error) {
      console.error('[dsh-multi-version] conversation publication failed:', error)
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): readonly RunRecord[] {
    return [...this.readyLedgers].flatMap(ledger => ledger.snapshot())
      .filter((record, index, records) => records.findIndex(candidate => candidate.id === record.id) === index)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /** Load/recover the session workspace ledger before returning its visible runs. */
  async runsForSession(sessionId: string): Promise<readonly RunRecord[]> {
    let workspace: string
    try {
      workspace = await realpath(await this.dependencies.workspaceResolver.resolve(sessionId))
    } catch (error) {
      if (error instanceof WorkspaceUnavailableError) return []
      throw error
    }
    const ledger = await this.ledgerFor(workspace)
    return ledger.snapshot().filter(run => run.sessionId === sessionId)
  }

  /** Return one completed response after resolving its exact session workspace ledger. */
  async resultForSession(sessionId: string, runId: string, requestedVersionId: string): Promise<VersionResult> {
    const workspace = await realpath(await this.dependencies.workspaceResolver.resolve(sessionId))
    const ledger = await this.ledgerFor(workspace)
    const run = ledger.get(runId)
    if (run === undefined || run.sessionId !== sessionId) throw new Error('run is not owned by this session')
    const version = run.versions.find(candidate => candidate.id === requestedVersionId)
    if (version === undefined) throw new Error('unknown version')
    if (version.phase !== 'completed') throw new Error('version result is not complete')
    const markdown = await readFile(join(run.runDirectory, version.relativeDirectory, 'response.md'), 'utf8')
    return {
      runId,
      versionId: version.id,
      title: version.title ?? `Version ${version.index}`,
      markdown,
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-multi-version] state listener failed:', error)
      }
    }
  }

  private async ledgerFor(workspace: string): Promise<RunLedger> {
    const root = join(workspace, '.multi-version')
    let pending = this.ledgers.get(root)
    if (pending === undefined) {
      pending = (async () => {
        const ledger = new RunLedger(root, this.dependencies.sources.now)
        await ledger.load()
        const recovered = await ledger.recoverInterrupted()
        for (const record of recovered) {
          await this.writeText(join(record.runDirectory, 'SUMMARY.md'), renderSummary(record))
          await this.writeJson(join(record.runDirectory, 'index.json'), record)
        }
        this.readyLedgers.add(ledger)
        for (const record of ledger.snapshot()) this.publish(record, 'observed')
        return ledger
      })()
      this.ledgers.set(root, pending)
      void pending.catch(() => {
        if (this.ledgers.get(root) === pending) this.ledgers.delete(root)
      })
    }
    return pending
  }

  async start(request: StartRunRequest): Promise<string> {
    validateStartRequest(request)
    const workspace = await realpath(await this.dependencies.workspaceResolver.resolve(request.sessionId))
    const created = this.dependencies.sources.now()
    const runId = safeRunId(created, this.dependencies.sources.randomId())
    const ledger = await this.ledgerFor(workspace)
    const runDirectory = await prepareRunDirectory(workspace, runId)
    const versions: VersionRecord[] = Array.from({ length: request.options.count }, (_, offset) => {
      const id = versionId(offset + 1)
      return { id, index: offset + 1, phase: 'pending', relativeDirectory: join('versions', id) }
    })
    const record: RunRecord = {
      schemaVersion: 1,
      revision: 0,
      id: runId,
      sessionId: request.sessionId,
      sourceWorkspace: workspace,
      runDirectory,
      phase: 'preparing',
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
      options: request.options,
      promptPreview: request.submission.preview,
      versions,
      warnings: [],
    }
    try {
      await this.writeJson(join(runDirectory, 'request.json'), request)
      await ledger.create(record)
    } catch (error) {
      await rm(runDirectory, { recursive: true, force: true })
      throw error
    }
    this.publish(record, 'started')

    const controller = new AbortController()
    const settled = this.execute(ledger, record, request, controller.signal)
      .catch(() => {})
      .finally(() => {
        this.active.delete(runId)
        this.emit()
      })
    this.active.set(runId, { controller, settled, ledger })
    this.emit()
    return runId
  }

  cancel(sessionId: string, runId: string): boolean {
    const active = this.active.get(runId)
    if (active === undefined || active.ledger.get(runId)?.sessionId !== sessionId) return false
    active.controller.abort(new Error('run cancelled by user'))
    return true
  }

  async wait(runId: string): Promise<void> {
    await this.active.get(runId)?.settled
  }

  private async execute(ledger: RunLedger, initial: RunRecord, request: StartRunRequest, signal: AbortSignal): Promise<void> {
    let briefs: readonly VersionBrief[] | undefined
    try {
      const layout = await materializeWorkspace(
        initial.sourceWorkspace,
        initial.runDirectory,
        request.options.count,
        signal,
        request.options.usePlanner,
      )
      signal.throwIfAborted()

      if (request.options.usePlanner) {
        await ledger.update(initial.id, current => ({ ...current, phase: 'planning' }))
        this.emit()
        if (this.dependencies.planner === undefined || layout.plannerWorkspace === undefined) {
          throw new Error('planner mode requires an available planner and an isolated planner workspace')
        }
        const planned = await this.dependencies.planner.plan({
          runId: initial.id,
          sessionId: initial.sessionId,
          cwd: layout.plannerWorkspace,
          submission: request.submission,
          requestedCount: request.options.count,
        }, signal)
        validateBriefs(planned, request.options.count)
        briefs = planned
        await this.writeJson(join(initial.runDirectory, 'planner.json'), {
          requested: true,
          briefs,
        })
      }

      await ledger.update(initial.id, current => ({ ...current, phase: 'running' }))
      this.emit()
      const indices = Array.from({ length: request.options.count }, (_, index) => index + 1)
      const settlements = await runBounded(indices, request.options.concurrency, async (index) => {
        signal.throwIfAborted()
        const id = versionId(index)
        const workspace = layout.versionWorkspaces[index - 1]!
        const started = this.dependencies.sources.now()
        await ledger.update(initial.id, current => replaceVersion(current, index, version => ({
          ...version,
          phase: 'running',
          startedAt: started.toISOString(),
        })))
        this.emit()
        const versionDirectory = join(initial.runDirectory, 'versions', id)
        try {
          const result = await this.dependencies.executor.execute({
            runId: initial.id,
            sessionId: initial.sessionId,
            versionId: id,
            index,
            cwd: workspace,
            submission: request.submission,
            ...(briefs?.[index - 1] === undefined ? {} : { brief: briefs[index - 1] }),
          }, signal)
          const finished = this.dependencies.sources.now()
          const description = deriveIntroduction(result.markdown, briefs?.[index - 1])
          await this.writeText(join(versionDirectory, 'response.md'), result.markdown.endsWith('\n') ? result.markdown : `${result.markdown}\n`)
          await this.writeJson(join(versionDirectory, 'response.json'), result.raw)
          await this.writeJson(join(versionDirectory, 'status.json'), { phase: 'completed', startedAt: started.toISOString(), finishedAt: finished.toISOString() })
          await ledger.update(initial.id, current => replaceVersion(current, index, version => ({
            ...version,
            phase: 'completed',
            title: description.title,
            introduction: description.introduction,
            finishedAt: finished.toISOString(),
            durationMs: Math.max(0, finished.getTime() - started.getTime()),
          })))
        } catch (error) {
          const finished = this.dependencies.sources.now()
          const cancelled = signal.aborted
          await this.writeJson(join(versionDirectory, 'status.json'), {
            phase: cancelled ? 'cancelled' : 'failed',
            startedAt: started.toISOString(),
            finishedAt: finished.toISOString(),
            error: message(error),
          })
          await ledger.update(initial.id, current => replaceVersion(current, index, version => ({
            ...version,
            phase: cancelled ? 'cancelled' : 'failed',
            finishedAt: finished.toISOString(),
            durationMs: Math.max(0, finished.getTime() - started.getTime()),
            error: message(error),
          })))
        } finally {
          this.emit()
        }
      }, signal)
      const infrastructureFailures = settlements.filter(settlement => settlement.status === 'rejected')
      if (!signal.aborted && infrastructureFailures.length > 0) {
        throw new Error(`candidate infrastructure failed: ${infrastructureFailures.map(failure => message(failure.reason)).join('; ')}`)
      }

      const terminal = await ledger.update(initial.id, current => ({
        ...current,
        phase: signal.aborted ? 'cancelled' : 'completed',
        versions: current.versions.map(version => signal.aborted && version.phase === 'pending'
          ? { ...version, phase: 'cancelled', error: 'Run cancelled before this candidate started.' }
          : version),
      }))
      await this.writeText(join(initial.runDirectory, 'SUMMARY.md'), renderSummary(terminal))
      await this.writeJson(join(initial.runDirectory, 'index.json'), terminal)
      this.publish(terminal, 'settled')
      this.emit()
    } catch (error) {
      const terminal = await ledger.update(initial.id, current => ({
        ...current,
        phase: signal.aborted ? 'cancelled' : 'failed',
        error: message(error),
        versions: current.versions.map(version => version.phase === 'pending' || version.phase === 'running'
          ? { ...version, phase: signal.aborted ? 'cancelled' : 'failed', error: message(error) }
          : version),
      }))
      await this.writeText(join(initial.runDirectory, 'SUMMARY.md'), renderSummary(terminal))
      await this.writeJson(join(initial.runDirectory, 'index.json'), terminal)
      this.publish(terminal, 'settled')
      this.emit()
    }
  }
}
