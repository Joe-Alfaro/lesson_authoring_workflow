'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { errorText, sendJson } from './api'
import { formatUsd } from './format'
import { Modal } from './modal'

interface RaiseCapDialogProps {
  runId: string
  capUsd: number
  costUsd: number
  globalCapUsd: number
  remainingUsd: number
  onSaved: () => void
  onClose: () => void
}

/**
 * D-024 (1): an admin raises a stopped run's cap inside the global SPEND_CAP_USD budget, so the
 * author can resume it.
 */
export function RaiseCapDialog({
  runId,
  capUsd,
  costUsd,
  globalCapUsd,
  remainingUsd,
  onSaved,
  onClose,
}: RaiseCapDialogProps) {
  const id = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [value, setValue] = useState(capUsd.toFixed(2))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    const amount = Number(value.replace(/^\$/, '').trim())
    if (value.trim() === '' || !Number.isFinite(amount)) {
      setError('Enter the cap in dollars, for example 2.50.')
      return
    }
    setSaving(true)
    const result = await sendJson(`/api/generation/runs/${runId}/cap`, 'PUT', { capUsd: amount })
    setSaving(false)
    if (!result.ok) {
      setError(errorText(result))
      return
    }
    onSaved()
  }

  return (
    <Modal role="dialog" labelledBy={`${id}-title`} initialFocus={cancelRef} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} noValidate>
        <header>
          <h2 className="h3" id={`${id}-title`}>
            Raise the spend cap
          </h2>
          <p className="sub dialog-lead">
            This run has cost {formatUsd(costUsd)} and stopped at its {formatUsd(capUsd)} cap. The
            global budget for all runs is {formatUsd(globalCapUsd)}, and {formatUsd(remainingUsd)}{' '}
            of it is left.
          </p>
        </header>
        <div className="body">
          <div className="field">
            <label className="lbl" htmlFor={`${id}-cap`}>
              Spend cap for this run
            </label>
            <input
              id={`${id}-cap`}
              className="input cap-input"
              type="text"
              inputMode="decimal"
              value={value}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : `${id}-help`}
              onChange={(event) => {
                setValue(event.target.value)
                setError(null)
              }}
            />
            {error ? (
              <p className="errmsg" id={`${id}-error`} role="alert">
                {error}
              </p>
            ) : (
              <p className="help" id={`${id}-help`}>
                In dollars. After saving, the author can resume the run.
              </p>
            )}
          </div>
        </div>
        <footer>
          <button ref={cancelRef} type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            Save cap
          </button>
        </footer>
      </form>
    </Modal>
  )
}
