'use client'
// R14 restore confirmation (mockup R14-restore-confirm): an alertdialog, focus starts on Cancel.
import { useEffect, useId, useRef } from 'react'
import { Icon } from '../lesson/lesson_icons'

export function RestoreDialog({
  when,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  when: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  const bodyId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => previous?.focus()
  }, [])

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    // Keep focus inside the dialog.
    const buttons = [...(dialogRef.current?.querySelectorAll('button') ?? [])]
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="scrim">
      <div
        ref={dialogRef}
        className="dialog restore-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <header>
          <h2 className="h3" id={titleId}>
            Restore the version from {when}?
          </h2>
        </header>
        <div className="body" id={bodyId}>
          <p>
            The lesson content goes back to this version for everyone editing it. The current
            content is saved as a new version first, so you can undo this from the list.
          </p>
          {error ? <p className="errmsg">{error}</p> : null}
        </div>
        <footer>
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={onConfirm}>
            <Icon name="restore" />
            Restore version
          </button>
        </footer>
      </div>
    </div>
  )
}
