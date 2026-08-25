import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { RunSummaryPanel } from './RunSummaryPanel.tsx'
import type { RunsView } from './run-controller.ts'
import { zh, type MultiVersionLocaleKey } from './locales.ts'
import styles from './multi-version.module.css'

export interface MultiVersionRunNodeInjected {
  readonly hooks: { readonly runs: HostObservable<RunsView> }
  readonly ensure: () => Promise<void>
  readonly cancel: (runId: string) => Promise<void>
}

export type MultiVersionRunNodeProps = PropsRuntime<'conversation.chat.node', 'multi-version-run'>
  & InjectFace<MultiVersionRunNodeInjected>
  & PropsLocale<'multiVersion'>

function dictionary(t: (key: MultiVersionLocaleKey) => string): Record<MultiVersionLocaleKey, string> {
  return Object.fromEntries(
    (Object.keys(zh) as MultiVersionLocaleKey[]).map(key => [key, t(key)]),
  ) as Record<MultiVersionLocaleKey, string>
}

/** One durable command lifecycle rendered as an ordinary item in the Chat transcript. */
export function MultiVersionRunNode({ node, useRuns, ensure, cancel, t }: MultiVersionRunNodeProps): JSX.Element {
  const view = useRuns(current => current)
  const runId = node.data.runId
  const run = view.runs.find(candidate => candidate.id === runId)
  useEffect(() => { void ensure() }, [ensure])
  const text = dictionary(t)

  return (
    <div className={styles.runNode} data-dsh-plugin="multi-version" data-dsh-part="run-node">
      {view.error !== undefined && <p className={styles.warning}>{view.error}</p>}
      {run === undefined
        ? <p className={styles.runPlaceholder} role="status">{view.status === 'cold' || view.status === 'loading' ? text.runLoading : text.runUnavailable}</p>
        : (
            <RunSummaryPanel
              run={run}
              dictionary={text}
              onCancel={id => { void cancel(id) }}
            />
          )}
    </div>
  )
}
