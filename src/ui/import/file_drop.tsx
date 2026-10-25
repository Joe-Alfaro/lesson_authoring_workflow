'use client'

import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ErrorIcon, FileIcon } from '../icons'

interface FileDropProps {
  id: string
  label: ReactNode
  /** Shown when no file is chosen. */
  prompt: ReactNode
  hint: string
  file: File | null
  onFile: (file: File | null) => void
  error?: string | null
}

/**
 * A labelled CSV file field drawn as a drop zone: "Choose file" opens the picker and a file can
 * also be dropped on it. The native input stays labelled for assistive tech and tests but is
 * out of the tab order, since the button is the keyboard path.
 */
export function FileDrop({ id, label, prompt, hint, file, onFile, error }: FileDropProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setOver(false)
    const dropped = event.dataTransfer.files[0]
    if (dropped) {
      onFile(dropped)
    }
  }

  return (
    <>
      <label className="lbl" htmlFor={id}>
        {label}
      </label>
      <div
        className={`drop${over ? ' over' : ''}${error ? ' err' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
      >
        <FileIcon />
        <div>
          {file ? (
            <>
              <b>{file.name}</b> is attached.
            </>
          ) : (
            prompt
          )}
          <br />
          <span className="caption" id={hintId}>
            {hint}
          </span>
        </div>
        <span className="spacer" />
        {file ? (
          <button className="btn quiet sm" type="button" onClick={() => onFile(null)}>
            Remove
          </button>
        ) : null}
        <button
          className="btn sm"
          type="button"
          aria-describedby={hintId}
          onClick={() => input.current?.click()}
        >
          Choose file
        </button>
        <input
          ref={input}
          className="sr"
          id={id}
          type="file"
          accept=".csv,text/csv"
          tabIndex={-1}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hintId}
          onChange={(event) => {
            onFile(event.target.files?.[0] ?? null)
            event.target.value = ''
          }}
        />
      </div>
      {error ? (
        <p className="errmsg" id={errorId}>
          <ErrorIcon />
          <span>{error}</span>
        </p>
      ) : null}
    </>
  )
}
