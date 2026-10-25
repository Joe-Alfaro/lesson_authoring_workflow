'use client'

import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ErrorIcon, LinkIcon, UploadIcon } from '../icons'
import { FileDrop } from './file_drop'

export type OutlineSource = 'link' | 'csv'

/** Which field an error belongs to; the message is shown under it. */
export interface FormErrors {
  link?: string
  csv?: string
  eld?: string
}

export interface ImportFormValues {
  source: OutlineSource
  link: string
  csvFile: File | null
  eldFile: File | null
}

interface ImportFormProps {
  values: ImportFormValues
  errors: FormErrors
  onChange: (values: ImportFormValues) => void
  onSubmit: () => void
  onCancel: () => void
}

const SOURCES: { id: OutlineSource; label: string; icon: ReactNode }[] = [
  { id: 'link', label: 'Google Sheets link', icon: <LinkIcon /> },
  { id: 'csv', label: 'Upload CSV', icon: <UploadIcon /> },
]

/** R1 import form. Mockups: R1-import-empty.html and R1-import-error.html. */
export function ImportForm({ values, errors, onChange, onSubmit, onCancel }: ImportFormProps) {
  const linkInput = useRef<HTMLInputElement>(null)
  const tabs = useRef<Record<OutlineSource, HTMLButtonElement | null>>({ link: null, csv: null })

  // An error on the link moves focus there so it is read with its message.
  useEffect(() => {
    if (errors.link) {
      linkInput.current?.focus()
    }
  }, [errors.link])

  function selectSource(source: OutlineSource) {
    onChange({ ...values, source })
    tabs.current[source]?.focus()
  }

  // Arrow keys move between the two tabs (ARIA tabs pattern).
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      selectSource(values.source === 'link' ? 'csv' : 'link')
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form
      className="panel panel-pad"
      aria-labelledby="outline-heading"
      onSubmit={handleSubmit}
      noValidate
    >
      <h2 className="h3" id="outline-heading">
        Outline
      </h2>
      <div className="seg" role="tablist" aria-label="Outline source">
        {SOURCES.map(({ id, label, icon }) => (
          <button
            key={id}
            ref={(element) => {
              tabs.current[id] = element
            }}
            type="button"
            role="tab"
            id={`source-${id}`}
            aria-selected={values.source === id}
            aria-controls={`panel-${id}`}
            tabIndex={values.source === id ? 0 : -1}
            onClick={() => selectSource(id)}
            onKeyDown={handleTabKey}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {values.source === 'link' ? (
        <div className="field source" role="tabpanel" id="panel-link" aria-labelledby="source-link">
          <label className="lbl" htmlFor="sheet-link">
            Sheet link
          </label>
          <input
            ref={linkInput}
            className={`input${errors.link ? ' err' : ''}`}
            id="sheet-link"
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={values.link}
            onChange={(event) => onChange({ ...values, link: event.target.value })}
            aria-invalid={errors.link ? true : undefined}
            aria-describedby={errors.link ? 'sheet-link-error' : 'sheet-link-help'}
          />
          {errors.link ? (
            <p className="errmsg" id="sheet-link-error">
              <ErrorIcon />
              <span>{errors.link}</span>
            </p>
          ) : (
            <p className="help" id="sheet-link-help">
              The sheet must be shared as &quot;Anyone with the link can view&quot;. No Google
              sign-in is needed.
            </p>
          )}
        </div>
      ) : (
        <div className="field source" role="tabpanel" id="panel-csv" aria-labelledby="source-csv">
          <FileDrop
            id="outline-csv"
            label="CSV file"
            prompt={
              <>
                <b>Choose the outline</b> as a CSV file.
              </>
            }
            hint="In Google Sheets, open the Lesson Outline tab and choose File, Download, Comma-separated values."
            file={values.csvFile}
            onFile={(csvFile) => onChange({ ...values, csvFile })}
            error={errors.csv}
          />
        </div>
      )}

      <div className="field eld">
        <FileDrop
          id="eld-csv"
          label={
            <>
              ELD scope and sequence{' '}
              <span className="muted" style={{ fontWeight: 400 }}>
                (optional)
              </span>
            </>
          }
          prompt={
            <>
              <b>Attach an ELD file</b> as a CSV export of its tab.
            </>
          }
          hint="Rows are matched to lessons by arc, lesson number and type. Empty fields are ignored."
          file={values.eldFile}
          onFile={(eldFile) => onChange({ ...values, eldFile })}
          error={errors.eld}
        />
      </div>

      <div className="row actions">
        <button className="btn primary" type="submit">
          Read outline
        </button>
        <button className="btn quiet" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
