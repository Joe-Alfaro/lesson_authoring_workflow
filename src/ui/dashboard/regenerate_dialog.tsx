'use client'

import { useId, useRef } from 'react'
import { RetryIcon, WarningIcon } from '../icons'
import { formatUsd, lessonNumbersText } from './format'
import { Modal } from './modal'

interface RegenerateDialogProps {
  lessonNumbers: number[]
  editedLessonNumbers: number[]
  promptVersion: number
  estimatedUsd: number
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
  error?: string | null
}

/**
 * R11: regenerate one or more lessons with the current prompt. Lessons with human edits are
 * named, and their content is kept as a version first.
 */
export function RegenerateDialog({
  lessonNumbers,
  editedLessonNumbers,
  promptVersion,
  estimatedUsd,
  onConfirm,
  onClose,
  busy = false,
  error,
}: RegenerateDialogProps) {
  const id = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const count = lessonNumbers.length
  const what = count === 1 ? `lesson ${lessonNumbers[0]}` : `${count} lessons`
  const edited = editedLessonNumbers.length
  return (
    <Modal
      role="alertdialog"
      labelledBy={`${id}-title`}
      describedBy={`${id}-text`}
      initialFocus={cancelRef}
      onClose={onClose}
    >
      <header>
        <h2 className="h3" id={`${id}-title`}>
          Regenerate {what} with prompt v{promptVersion}?
        </h2>
      </header>
      <div className="body" id={`${id}-text`}>
        <p>{lessonNumbersText(lessonNumbers)} will be written again from their outline rows.</p>
        {edited > 0 ? (
          <div className="notice warn">
            <WarningIcon />
            <div>
              <b>
                {lessonNumbersText(editedLessonNumbers)} {edited === 1 ? 'has' : 'have'} human
                edits.
              </b>{' '}
              {edited === 1 ? 'Its' : 'Their'} current content is saved as a version first, so you
              can restore it from version history.
            </div>
          </div>
        ) : null}
        <p className="caption">
          Estimated cost {formatUsd(estimatedUsd)}. Each lesson returns to Draft when it finishes;
          reviewers keep their assignments.
        </p>
        {error ? (
          <p className="errmsg" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer>
        <button ref={cancelRef} type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={onConfirm}>
          <RetryIcon />
          Regenerate {count === 1 ? '1 lesson' : `${count} lessons`}
        </button>
      </footer>
    </Modal>
  )
}
