import type { CapturedSubmission, RunOptions, RunView, StartRunRequest, VersionResult } from '../core/types.ts'

/** Two-phase composer capture backed by DSH session input state and codecs. */
export interface PreparedComposerSubmission {
  readonly submission: CapturedSubmission
  commit(): boolean
  rollback(): void
}

export interface ConversationInputAdapter {
  prepare(sessionId: string): Promise<PreparedComposerSubmission | null>
}

export interface MultiVersionHostTransport {
  start(request: StartRunRequest): Promise<{ readonly runId: string }>
  cancel(sessionId: string, runId: string): Promise<boolean>
  runs(sessionId: string): Promise<readonly RunView[]>
  result(sessionId: string, runId: string, versionId: string): Promise<VersionResult>
}

export interface StartOutcome {
  readonly runId: string
  /** False means the user edited the composer during Host admission; the new draft was preserved. */
  readonly composerCommitted: boolean
}

/** Coordinates atomic composer capture with Host admission. */
export class MultiVersionInputController {
  private active = false

  constructor(
    private readonly adapter: ConversationInputAdapter,
    private readonly transport: Pick<MultiVersionHostTransport, 'start'>,
  ) {}

  get busy(): boolean {
    return this.active
  }

  async start(sessionId: string, options: RunOptions): Promise<StartOutcome> {
    if (this.active) throw new Error('a multi-version submission is already being prepared')
    this.active = true
    let prepared: PreparedComposerSubmission | null = null
    let admitted = false
    try {
      prepared = await this.adapter.prepare(sessionId)
      if (prepared === null) throw new Error('the current composer has no capturable submission')
      const accepted = await this.transport.start({ sessionId, submission: prepared.submission, options })
      admitted = true
      let composerCommitted = false
      try {
        composerCommitted = prepared.commit()
      } catch {
        // The Host run already exists. Preserve the live draft and report admission success.
      }
      return { ...accepted, composerCommitted }
    } catch (error) {
      if (!admitted) prepared?.rollback()
      throw error
    } finally {
      this.active = false
    }
  }
}
