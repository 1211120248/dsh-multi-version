import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { zh, type MultiVersionLocaleKey } from './locales.ts'
import styles from './multi-version.module.css'

export interface ResultDialogProps {
  readonly title: string
  readonly loading: boolean
  readonly markdown?: string
  readonly error?: string
  readonly dictionary?: Record<MultiVersionLocaleKey, string>
  readonly onClose: () => void
}

/** Plain-text full candidate response; markdown is never interpreted as HTML. */
export function ResultDialog({
  title,
  loading,
  markdown,
  error,
  dictionary = zh,
  onClose,
}: ResultDialogProps): JSX.Element {
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      closeLabel={dictionary.closeResult}
      className={styles.resultDialog}
      footer={(
        <Button variant="primary" autoFocus onClick={onClose}>{dictionary.closeResult}</Button>
      )}
    >
      <div className={styles.resultBody} data-dsh-plugin="multi-version">
        {loading && <p className={styles.resultState} role="status">{dictionary.loadingResult}</p>}
        {error !== undefined && <p className={styles.warning} role="alert">{error}</p>}
        {markdown !== undefined && (
          <pre className={styles.resultContent} data-dsh-part="result-content">{markdown}</pre>
        )}
      </div>
    </Modal>
  )
}
