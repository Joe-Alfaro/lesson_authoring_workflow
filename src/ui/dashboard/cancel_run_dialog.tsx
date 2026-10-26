'use client'

import { useId, useRef } from 'react'
import { StopIcon } from '../icons'
import { Modal } from './modal'

interface CancelRunDialogProps {
  queued: number
  generating: number
  generated: number
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
}

function noun(count: number): string {
  return count === 1 ? 'lesson' : 'lessons'
}

/** The dialog text without zero counts ("The 0 queued lessons won't start" reads wrong). */
function cancelText(queued: number, generating: number, generated: number): string {
  const sentences: string[] = []
  if (queued > 0) {
    sentences.push(`The ${queued} queued ${noun(queued)} won't start.`)
  }
  const kept = `the ${generated} generated ${noun(generated)}`
  if (generating > 0) {
    const along = generated > 0 ? `, along with ${kept}` : ''
    sentences.push(
      `The ${generating} ${noun(generating)} being generated will finish and be kept${along}.`,
    )
  } else if (generated > 0) {
    sentences.push(`The ${generated} generated ${noun(generated)} will be kept.`)
  }
  sentences.push('You can generate the rest later.')
  return sentences.join(' ')
}

/** R11: what stops and what is kept; "Keep running" is the safe choice. */
export function CancelRunDialog({
  queued,
  generating,
  generated,
  onConfirm,
  onClose,
  busy = false,
}: CancelRunDialogProps) {
  const id = useId()
  const keepRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      role="alertdialog"
      labelledBy={`${id}-title`}
      describedBy={`${id}-text`}
      initialFocus={keepRef}
      onClose={onClose}
    >
      <header>
        <h2 className="h3" id={`${id}-title`}>
          Cancel this run?
        </h2>
      </header>
      <div className="body">
        <p id={`${id}-text`}>{cancelText(queued, generating, generated)}</p>
      </div>
      <footer>
        <button ref={keepRef} type="button" className="btn" onClick={onClose}>
          Keep running
        </button>
        <button type="button" className="btn danger-fill" disabled={busy} onClick={onConfirm}>
          <StopIcon />
          Cancel run
        </button>
      </footer>
    </Modal>
  )
}
