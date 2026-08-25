import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RunPhase, RunView, VersionView } from '../core/types.ts'
import { zh, type MultiVersionLocaleKey } from './locales.ts'
import styles from './multi-version.module.css'

export interface RunSummaryPanelProps {
  readonly run: RunView
  readonly dictionary?: Record<MultiVersionLocaleKey, string>
  readonly onOpenResult?: (runId: string, versionId: string, title: string) => void
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

export function RunSummaryPanel({ run, dictionary = zh, onOpenResult, onCancel }: RunSummaryPanelProps): JSX.Element {
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
              <span>{version.introduction ?? version.error ?? versionStatus(dictionary, version)}</span>
            </div>
            <div className={styles.versionActions}>
              <span>{versionStatus(dictionary, version)}</span>
              {version.phase === 'completed' && onOpenResult !== undefined && (
                <Button
                  variant="toolbar"
                  size="sm"
                  onClick={() => onOpenResult(
                    run.id,
                    version.id,
                    version.title ?? format(dictionary, 'versionFallback', { index: String(version.index) }),
                  )}
                >
                  {dictionary.openResult}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
