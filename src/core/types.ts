export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** Serializable browser-to-Host prompt shape owned by this package. */
export type SubmissionPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string; readonly name?: string }

/** Immutable input captured from the current composer without prior chat history. */
export interface CapturedSubmission {
  readonly parts: readonly SubmissionPart[]
  readonly preview: string
}

/** User-selected execution options. */
export interface RunOptions {
  readonly count: number
  readonly usePlanner: boolean
  readonly concurrency: number
}

/** Start request. The Host resolves the workspace from sessionId. */
export interface StartRunRequest {
  readonly sessionId: string
  readonly submission: CapturedSubmission
  readonly options: RunOptions
}

/** One planner-provided direction. */
export interface VersionBrief {
  readonly title: string
  readonly description: string
  readonly instruction: string
}

export type RunPhase = 'preparing' | 'planning' | 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'
export type VersionPhase = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'

/** Persisted result for one isolated candidate. */
export interface VersionRecord {
  readonly id: string
  readonly index: number
  readonly phase: VersionPhase
  readonly relativeDirectory: string
  readonly title?: string
  readonly introduction?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly durationMs?: number
  readonly error?: string
}

/** Host-authoritative record persisted in run.json. */
export interface RunRecord {
  readonly schemaVersion: 1
  readonly revision: number
  readonly id: string
  readonly sessionId: string
  readonly sourceWorkspace: string
  readonly runDirectory: string
  readonly phase: RunPhase
  readonly createdAt: string
  readonly updatedAt: string
  readonly options: RunOptions
  readonly promptPreview: string
  readonly versions: readonly VersionRecord[]
  readonly warnings: readonly string[]
  readonly error?: string
}

/** Browser-safe candidate projection with Host-owned relative paths removed. */
export type VersionView = Omit<VersionRecord, 'relativeDirectory'>

/** Browser-safe run projection. Filesystem authority never enters Client state. */
export type RunView = Omit<RunRecord, 'sourceWorkspace' | 'runDirectory' | 'versions'> & {
  readonly versions: readonly VersionView[]
}

/** Candidate input supplied to a runtime adapter. */
export interface CandidateExecutionRequest {
  readonly runId: string
  readonly sessionId: string
  readonly versionId: string
  readonly index: number
  readonly cwd: string
  readonly submission: CapturedSubmission
  readonly brief?: VersionBrief
}

/** Candidate output captured before its hidden session is disposed. */
export interface CandidateExecutionResult {
  readonly markdown: string
  readonly raw: JsonValue
}

/** Future DSH adapter boundary; tests use deterministic fakes. */
export interface CandidateExecutor {
  execute(request: CandidateExecutionRequest, signal: AbortSignal): Promise<CandidateExecutionResult>
}

/** Host-owned planner input, including its isolated working directory. */
export interface VersionPlannerRequest {
  readonly runId: string
  readonly sessionId: string
  readonly cwd: string
  readonly submission: CapturedSubmission
  readonly requestedCount: number
}

/** Optional planner boundary. A valid result always has exactly requestedCount distinct entries. */
export interface VersionPlanner {
  plan(request: VersionPlannerRequest, signal: AbortSignal): Promise<readonly VersionBrief[]>
}

/** Expected read-only state for a new session whose Host workspace has not been materialized yet. */
export class WorkspaceUnavailableError extends Error {
  override readonly name = 'WorkspaceUnavailableError'
}

/** Host-only workspace authority. Browser input never carries an arbitrary path. */
export interface WorkspaceResolver {
  resolve(sessionId: string): Promise<string>
}

/** Clock and id sources are injectable so orchestration remains deterministic in tests. */
export interface RuntimeSources {
  readonly now: () => Date
  readonly randomId: () => string
}
