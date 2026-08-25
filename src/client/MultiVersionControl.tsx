import { useMemo, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { MAX_CONCURRENCY, MAX_VERSION_COUNT, MIN_VERSION_COUNT } from '../core/invariant.ts'
import type { RunOptions } from '../core/types.ts'
import type { MultiVersionInputController } from './input-adapter.ts'
import { zh, type MultiVersionLocaleKey } from './locales.ts'
import styles from './multi-version.module.css'

export interface MultiVersionText {
  readonly button: string
  readonly title: string
  readonly count: string
  readonly planner: string
  readonly concurrency: string
  readonly output: string
  readonly outputValue: string
  readonly cancel: string
  readonly start: string
  readonly starting: string
  readonly unavailable: string
  readonly draftPreserved: string
}

export function textFromDictionary(dictionary: Record<MultiVersionLocaleKey, string>): MultiVersionText {
  return {
    button: dictionary.button,
    title: dictionary.title,
    count: dictionary.count,
    planner: dictionary.planner,
    concurrency: dictionary.concurrency,
    output: dictionary.output,
    outputValue: dictionary.outputValue,
    cancel: dictionary.cancel,
    start: dictionary.start,
    starting: dictionary.starting,
    unavailable: dictionary.unavailable,
    draftPreserved: dictionary.draftPreserved,
  }
}

export const zhText = textFromDictionary(zh)

export interface MultiVersionControlProps {
  readonly sessionId: string
  readonly controller?: MultiVersionInputController
  readonly hasSubmission: boolean
  readonly text?: MultiVersionText
  readonly onStarted?: (runId: string) => void
}

export function MultiVersionControl({ sessionId, controller, hasSubmission, text = zhText, onStarted }: MultiVersionControlProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(3)
  const [usePlanner, setUsePlanner] = useState(true)
  const [concurrency, setConcurrency] = useState(3)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const available = controller !== undefined
  const valid = Number.isSafeInteger(count) && count >= MIN_VERSION_COUNT && count <= MAX_VERSION_COUNT
    && Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= Math.min(MAX_CONCURRENCY, count)
  const options = useMemo<RunOptions>(() => ({ count, usePlanner, concurrency }), [count, usePlanner, concurrency])

  const changeCount = (next: number): void => {
    setCount(next)
    setConcurrency(current => Math.min(current, next))
  }

  const start = async (): Promise<void> => {
    if (controller === undefined) return
    setBusy(true)
    setNotice(undefined)
    try {
      const result = await controller.start(sessionId, options)
      if (!result.composerCommitted) setNotice(text.draftPreserved)
      onStarted?.(result.runId)
      setOpen(false)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.root} data-dsh-plugin="multi-version">
      <Button
        variant="toolbar"
        size="sm"
        className={styles.trigger}
        data-dsh-part="trigger"
        disabled={!hasSubmission || busy}
        title={available ? text.button : text.unavailable}
        onClick={() => setOpen(true)}
      >
        {text.button}
      </Button>
      <Modal
        open={open}
        onClose={() => { if (!busy) setOpen(false) }}
        title={text.title}
        closeLabel={text.cancel}
        className={styles.configDialog}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{text.cancel}</Button>
            <Button variant="primary" disabled={busy || !available || !valid} onClick={() => { void start() }}>
              {busy ? text.starting : text.start}
            </Button>
          </>
        )}
      >
        <div className={styles.form} data-dsh-plugin="multi-version">
          {!available && <p className={styles.warning}>{text.unavailable}</p>}
          <label className={styles.field}>
            <span>{text.count}</span>
            <Input
              className={styles.numberInput}
              aria-label={text.count}
              type="number"
              min={MIN_VERSION_COUNT}
              max={MAX_VERSION_COUNT}
              value={count}
              disabled={busy}
              onChange={event => changeCount(Number(event.target.value))}
            />
          </label>
          <label className={styles.plannerField}>
            <input type="checkbox" checked={usePlanner} disabled={busy} onChange={event => setUsePlanner(event.target.checked)} />
            <span>{text.planner}</span>
          </label>
          <label className={styles.field}>
            <span>{text.concurrency}</span>
            <Input
              className={styles.numberInput}
              aria-label={text.concurrency}
              type="number"
              min={1}
              max={Math.min(MAX_CONCURRENCY, count)}
              value={concurrency}
              disabled={busy}
              onChange={event => setConcurrency(Number(event.target.value))}
            />
          </label>
          <div className={styles.output}>
            <span>{text.output}</span>
            <code>{text.outputValue}</code>
          </div>
        </div>
      </Modal>
      {notice !== undefined && <span className={styles.notice} role="status">{notice}</span>}
    </div>
  )
}
