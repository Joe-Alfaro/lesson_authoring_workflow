'use client'

import Link from 'next/link'
import { useId, useRef, useState } from 'react'
import { PlayIcon } from '../icons'
import { formatUsd } from './format'
import { Modal } from './modal'

export interface ModelChoice {
  id: string
  label: string
  /** Estimate for `lessonCount` lessons on this model. */
  estimatedUsd: number
}

export interface StartOptions {
  model?: string
  scope: 'all' | 'selected'
}

interface StartGenerationDialogProps {
  lessonCount: number
  modelLabel: string
  promptVersion: number
  promptHref: string
  estimatedUsd: number
  capUsd: number
  concurrency: number
  onStart: (options: StartOptions) => void
  onClose: () => void
  /** Models to choose from, default first (R12: the model is set per run). */
  models?: ModelChoice[]
  /** "All 41 numbered lessons" unless some lessons are generated already. */
  scopeLabel?: string
  /** Lessons selected in the table; "Selected lessons" is off when there are none. */
  selectedCount?: number
  /** "saved by Author 01 today at 10:31". */
  promptSaved?: string
  error?: string | null
  busy?: boolean
}

function modelOptionText(label: string, isDefault: boolean): string {
  const notes = [label === 'Haiku-class' && 'low cost', isDefault && 'default'].filter(Boolean)
  return notes.length > 0 ? `${label} (${notes.join(', ')})` : label
}

/** R6, R12: what a run will generate, on which model and prompt, and what it should cost. */
export function StartGenerationDialog({
  lessonCount,
  modelLabel,
  promptVersion,
  promptHref,
  estimatedUsd,
  capUsd,
  concurrency,
  onStart,
  onClose,
  models,
  scopeLabel,
  selectedCount = 0,
  promptSaved,
  error,
  busy = false,
}: StartGenerationDialogProps) {
  const id = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const choices = models ?? [{ id: '', label: modelLabel, estimatedUsd }]
  const [modelId, setModelId] = useState(choices[0]!.id)
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const model = choices.find((choice) => choice.id === modelId) ?? choices[0]!
  const count = scope === 'selected' ? selectedCount : lessonCount
  const estimate = lessonCount > 0 ? (model.estimatedUsd / lessonCount) * count : 0

  return (
    <Modal
      role="dialog"
      labelledBy={`${id}-title`}
      initialFocus={cancelRef}
      onClose={onClose}
      width={600}
    >
      <header>
        <h2 className="h3" id={`${id}-title`}>
          Generate lessons
        </h2>
        <p className="sub dialog-lead">
          Lessons are generated in the background. You can close the browser; the run keeps going.
        </p>
      </header>
      <div className="body">
        <fieldset className="field">
          <legend className="lbl">Lessons</legend>
          <div className="row scope">
            <label className="row">
              <input
                type="radio"
                name={`${id}-scope`}
                checked={scope === 'all'}
                onChange={() => setScope('all')}
              />
              {scopeLabel ?? `All ${lessonCount} numbered lessons`}
            </label>
            <label className="row">
              <input
                type="radio"
                name={`${id}-scope`}
                checked={scope === 'selected'}
                disabled={selectedCount === 0}
                onChange={() => setScope('selected')}
              />
              Selected lessons
            </label>
          </div>
          <p className="help">
            Flex days aren&apos;t included. Generate a flex day from its row when you need one.
          </p>
        </fieldset>
        <div className="field">
          <label className="lbl" htmlFor={`${id}-model`}>
            Model
          </label>
          <select
            id={`${id}-model`}
            className="select"
            value={model.id}
            onChange={(event) => setModelId(event.target.value)}
          >
            {choices.map((choice, index) => (
              <option key={choice.id} value={choice.id}>
                {modelOptionText(choice.label, index === 0)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="lbl">Prompt</span>
          <div className="row">
            <b>v{promptVersion}</b>
            {promptSaved ? <span className="sub">{promptSaved}</span> : null}
            <span className="spacer" />
            <Link className="inline-link" href={promptHref}>
              View prompt
            </Link>
          </div>
        </div>
        <div className="estimate">
          <dl className="kv">
            <dt>Estimated cost for {count === 1 ? '1 lesson' : `${count} lessons`}</dt>
            <dd className="big">{formatUsd(estimate)}</dd>
            <dt>Spend cap for this run</dt>
            <dd>{formatUsd(capUsd)}</dd>
            <dt>Concurrency</dt>
            <dd>{concurrency} lessons at a time</dd>
          </dl>
          <p className="caption">
            The estimate is the number of lessons times the expected cost of one lesson on this
            model. If the run reaches the cap, no new lessons start and finished ones are kept.
          </p>
        </div>
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
        <button
          type="button"
          className="btn primary"
          disabled={busy || count === 0}
          onClick={() => onStart({ model: model.id || undefined, scope })}
        >
          <PlayIcon />
          Start generation
        </button>
      </footer>
    </Modal>
  )
}
