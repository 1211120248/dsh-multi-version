import type { RunView, VersionResult } from '../core/types.ts'
import type { MultiVersionHostTransport } from './input-adapter.ts'

export interface RunsView {
  readonly status: 'cold' | 'loading' | 'ready' | 'error'
  readonly runs: readonly RunView[]
  readonly error?: string
}

/** One session-scoped observable with bounded polling while its slot is mounted. */
export class MultiVersionRunController {
  private view: RunsView = { status: 'cold', runs: [] }
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | undefined
  private request: Promise<void> | undefined
  private disposed = false

  constructor(
    private readonly transport: MultiVersionHostTransport,
    private readonly sessionId: string,
  ) {}

  readonly getSnapshot = (): RunsView => this.view

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    void this.ensure()
    if (this.timer === undefined) {
      this.timer = setInterval(() => { void this.refresh() }, 1_000)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer !== undefined) {
        clearInterval(this.timer)
        this.timer = undefined
      }
    }
  }

  async ensure(): Promise<void> {
    if (this.view.status !== 'cold') return
    this.set({ status: 'loading', runs: [] })
    await this.refresh()
  }

  async refresh(): Promise<void> {
    if (this.disposed) return
    if (this.request !== undefined) return this.request
    this.request = this.transport.runs(this.sessionId).then(
      runs => { this.set({ status: 'ready', runs }) },
      (error: unknown) => {
        this.set({
          status: 'error',
          runs: this.view.runs,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    ).finally(() => { this.request = undefined })
    return this.request
  }

  async cancel(runId: string): Promise<void> {
    await this.transport.cancel(this.sessionId, runId)
    await this.refresh()
  }

  async result(runId: string, versionId: string): Promise<VersionResult> {
    return this.transport.result(this.sessionId, runId, versionId)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.listeners.clear()
  }

  private set(view: RunsView): void {
    if (this.disposed) return
    this.view = view
    for (const listener of this.listeners) listener()
  }
}
