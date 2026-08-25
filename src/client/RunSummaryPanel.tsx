import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RunPhase, RunView, VersionView } from '../core/types.ts'
import { zh, type MultiVersionLocaleKey } from './locales.ts'
import styles from './multi-version.module.css'

export interface RunSummaryPanelProps {
  readonly run: RunView
  readonly dictionary?: Record<MultiVersionLocaleKey, string>
  readonly onCancel?: (runId: string) => void
}

function format(dictionary: Record<MultiVersionLocaleKey, string>, key: MultiVersionLocaleKey, values: Record<string, string>): string {
  let output = dictionary[key]
  for (const [name, value] of Object.entries(values)) output = output.replace(`{${name}}`, value)
  return output
}

function phaseLabel(dictionary: Record<MultiVersionLocaleKey, string>, phase: RunPhase): string {
  return dictionary[`phase.${phase}`]
}

function versionStatus(dictionary: Record<MultiVersionLocaleKey, string>, version: VersionView): string {
  if (version.phase === 'pending') return dictionary['phase.preparing']
  if (version.phase === 'running') return dictionary['phase.running']
  if (version.phase === 'completed') return dictionary['phase.completed']
  if (version.phase === 'cancelled') return dictionary['phase.cancelled']
  return dictionary['phase.failed']
}

function durationLabel(dictionary: Record<MultiVersionLocaleKey, string>, durationMs: number | undefined): string {
  if (durationMs === undefined) return dictionary.durationUnavailable
  if (durationMs < 1_000) return format(dictionary, 'durationMilliseconds', { value: String(durationMs) })
  const seconds = Math.floor(durationMs / 1_000)
  if (seconds < 60) return format(dictionary, 'durationSeconds', { value: String(seconds) })
  return format(dictionary, 'durationMinutes', {
    minutes: String(Math.floor(seconds / 60)),
    seconds: String(seconds % 60),
  })
}

function terminal(phase: RunView['phase']): boolean {
  return phase === 'completed' || phase === 'cancelled' || phase === 'failed' || phase === 'interrupted'
}

export function RunSummaryPanel({ run, dictionary = zh, onCancel }: RunSummaryPanelProps): JSX.Element {
  const cancellable = run.phase === 'preparing' || run.phase === 'planning' || run.phase === 'running'
  return (
    <section className={styles.runCard} data-dsh-plugin="multi-version" data-dsh-part="run-summary" aria-label={run.promptPreview}>
      <header className={styles.runHeader}>
        <div>
          <strong>{run.promptPreview || run.id}</strong>
          <div className={styles.runMeta}>
            <span>{format(dictionary, 'runCount', { count: String(run.options.count) })}</span>
            <span>{format(dictionary, 'runPlanner', { value: run.options.usePlanner ? dictionary.yes : dictionary.no })}</span>
            <span>{phaseLabel(dictionary, run.phase)}</span>
          </div>
        </div>
        {cancellable && onCancel !== undefined && (
          <Button variant="outline" size="sm" onClick={() => onCancel(run.id)}>{dictionary.cancelRun}</Button>
        )}
      </header>
      {run.warnings.map((warning, index) => <p className={styles.warning} key={`${index}:${warning}`}>{warning}</p>)}
      <ol className={styles.versionList}>
        {run.versions.map(version => (
          <li key={version.id} className={styles.versionRow}>
            <div>
              <strong>{version.title ?? format(dictionary, 'versionFallback', { index: String(version.index) })}</strong>
              <span>{format(dictionary, 'versionIntroduction', {
                value: version.introduction ?? version.error ?? versionStatus(dictionary, version),
              })}</span>
            </div>
            <div className={styles.versionActions}>
              <span>{format(dictionary, 'versionStatus', { value: versionStatus(dictionary, version) })}</span>
              <span>{format(dictionary, 'versionDuration', { value: durationLabel(dictionary, version.durationMs) })}</span>
            </div>
          </li>
        ))}
      </ol>
      {terminal(run.phase) && (
        <p className={styles.outputHint}>{format(dictionary, 'outputHint', { runId: run.id })}</p>
      )}
    </section>
  )
}
