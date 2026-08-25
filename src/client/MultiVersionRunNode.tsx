import { useEffect, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { VersionResult } from '../core/types.ts'
import { ResultDialog } from './ResultDialog.tsx'
import { RunSummaryPanel } from './RunSummaryPanel.tsx'
import type { RunsView } from './run-controller.ts'
import { zh, type MultiVersionLocaleKey } from './locales.ts'
import styles from './multi-version.module.css'

export interface MultiVersionRunNodeInjected {
  readonly hooks: { readonly runs: HostObservable<RunsView> }
  readonly ensure: () => Promise<void>
  readonly cancel: (runId: string) => Promise<void>
  readonly result: (runId: string, versionId: string) => Promise<VersionResult>
}

export type MultiVersionRunNodeProps = PropsRuntime<'conversation.chat.node', 'multi-version-run'>
  & InjectFace<MultiVersionRunNodeInjected>
  & PropsLocale<'multiVersion'>

interface ResultView {
  readonly key: string
  readonly title: string
  readonly loading: boolean
  readonly markdown?: string
  readonly error?: string
}

function dictionary(t: (key: MultiVersionLocaleKey) => string): Record<MultiVersionLocaleKey, string> {
  return Object.fromEntries(
    (Object.keys(zh) as MultiVersionLocaleKey[]).map(key => [key, t(key)]),
  ) as Record<MultiVersionLocaleKey, string>
}

/** One durable command lifecycle rendered as an ordinary item in the Chat transcript. */
export function MultiVersionRunNode({ node, useRuns, ensure, cancel, result, t }: MultiVersionRunNodeProps): JSX.Element {
  const view = useRuns(current => current)
  const [selected, setSelected] = useState<ResultView>()
  const runId = node.data.runId
  const run = view.runs.find(candidate => candidate.id === runId)
  useEffect(() => { void ensure() }, [ensure])
  const text = dictionary(t)

  const openResult = (versionId: string, title: string): void => {
    const key = `${runId}:${versionId}`
    setSelected({ key, title, loading: true })
    void result(runId, versionId).then(
      value => setSelected(current => current?.key === key
        ? { key, title: value.title, loading: false, markdown: value.markdown }
        : current),
      (error: unknown) => setSelected(current => current?.key === key
        ? { key, title, loading: false, error: error instanceof Error ? error.message : String(error) }
        : current),
    )
  }

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
              onOpenResult={(_id, versionId, title) => { openResult(versionId, title) }}
            />
          )}
      {selected !== undefined && (
        <ResultDialog
          title={selected.title}
          loading={selected.loading}
          markdown={selected.markdown}
          error={selected.error}
          dictionary={text}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  )
}
