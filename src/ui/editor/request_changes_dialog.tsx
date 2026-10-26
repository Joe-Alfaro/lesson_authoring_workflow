'use client'
// R23 request changes (mockup R23-request-changes): the note is required; a blank note is refused
// in the dialog without calling the route.
import { useId, useState } from 'react'
import { Icon } from '../lesson/lesson_icons'

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

  return (
    <div className="scrim">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        noValidate
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (note.trim() === '') {
            setMissing(true)
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
            id={fieldId}
            className={`textarea${missing ? ' err' : ''}`}
            rows={4}
            autoFocus
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
