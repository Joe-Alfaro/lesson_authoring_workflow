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
        <p id={`${id}-text`}>
          The {queued} queued {noun(queued)} won&apos;t start. The {generating} {noun(generating)}{' '}
          being generated will finish and be kept, along with the {generated} generated{' '}
          {noun(generated)}. You can generate the rest later.
        </p>
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
