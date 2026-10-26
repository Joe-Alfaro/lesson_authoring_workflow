'use client'
// R23 request changes (mockup R23-request-changes): the note is required; a blank note is refused
// in the dialog without calling the route. Modal behaviour: use_modal.ts.
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../lesson/lesson_icons'
import { useModal } from './use_modal'

export function RequestChangesDialog({
  lessonLabel,
  assignee,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  lessonLabel: string
  assignee: string | null
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (note: string) => void
}) {
  const titleId = useId()
  const fieldId = useId()
  const errorId = useId()
  const [note, setNote] = useState('')
  const [missing, setMissing] = useState(false)
  const dialogRef = useRef<HTMLFormElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  useModal(dialogRef, onCancel, { initialFocus: noteRef })
  // After a refused submit or a failed request, focus goes back to the note.
  useEffect(() => {
    if (error) noteRef.current?.focus()
  }, [error])

  return (
    <div className="scrim">
      <form
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (note.trim() === '') {
            setMissing(true)
            noteRef.current?.focus()
            return
          }
          onSubmit(note.trim())
        }}
      >
        <header>
          <h2 className="h3" id={titleId}>
            Request changes to {lessonLabel}
          </h2>
          <p className="sub">
            The lesson goes back to {assignee ?? 'its reviewer'} as Changes requested. Your note
            appears in its history.
          </p>
        </header>
        <div className="body">
          <label className="lbl" htmlFor={fieldId}>
            Note for the reviewer <span className="muted opt">(required)</span>
          </label>
          <textarea
            ref={noteRef}
            id={fieldId}
            className={`textarea${missing ? ' err' : ''}`}
            rows={4}
            required
            aria-invalid={missing ? 'true' : undefined}
            aria-describedby={missing ? errorId : undefined}
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              if (event.target.value.trim()) setMissing(false)
            }}
          />
          {missing ? (
            <p className="errmsg" id={errorId}>
              <Icon name="warning" />
              <span>Add a note so the reviewer knows what to change.</span>
            </p>
          ) : null}
          {error ? (
            <p className="errmsg" role="alert">
              <Icon name="warning" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
        <footer>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Request changes
          </button>
        </footer>
      </form>
    </div>
  )
}
