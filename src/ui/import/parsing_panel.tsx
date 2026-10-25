'use client'

import { useEffect, useState } from 'react'
import { CheckIcon, CircleIcon } from '../icons'

const STEP_INTERVAL_MS = 700

/**
 * R1 parsing state (mockup R1-import-parsing.html). The server reads the outline in one request,
 * so the steps advance on a timer to show what is happening; the last one waits for the answer.
 */
export function ParsingPanel({
  sourceLabel,
  firstStep,
  onCancel,
}: {
  sourceLabel: string
  firstStep: string
  onCancel: () => void
}) {
  const steps = [
    firstStep,
    'Reading rows: banner, arcs, lessons, flex days',
    'Matching standards codes to the reference data',
    'Matching ELD rows to lessons',
  ]
  const [current, setCurrent] = useState(1)

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((step) => Math.min(step + 1, steps.length - 1))
    }, STEP_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [steps.length])

  return (
    <section className="panel panel-pad" aria-labelledby="parsing-heading" aria-busy="true">
      <h2 className="h3" id="parsing-heading">
        Reading the outline
      </h2>
      <p className="sub" style={{ marginTop: 4 }}>
        From {sourceLabel}. Nothing is saved until you confirm the preview.
      </p>
      <div
        className="progress indet"
        style={{ marginTop: 20 }}
        role="progressbar"
        aria-label="Reading outline"
      >
        <i />
      </div>
      <ul className="steps">
        {steps.map((step, index) => {
          if (index < current) {
            return (
              <li key={step} className="done">
                <CheckIcon />
                {step}
              </li>
            )
          }
          if (index === current) {
            return (
              <li key={step} className="now" aria-current="step">
                <span className="dot breathe" />
                {step}
              </li>
            )
          }
          return (
            <li key={step} className="later">
              <CircleIcon />
              {step}
            </li>
          )
        })}
      </ul>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn quiet" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}
