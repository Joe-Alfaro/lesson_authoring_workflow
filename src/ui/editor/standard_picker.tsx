'use client'
// R15/R17: adding a front-matter standard is a combobox over the grade 6 reference data only
// (mockup R15-standard-picker). Enter adds the highlighted option; free text adds nothing.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { searchStandards, type StandardGroup, type StandardRef } from '../../editor/standards'

const PREVIEW_CHARS = 120

export interface PickerTarget {
  group: StandardGroup
  anchor: HTMLElement
  /** Codes already in the group. */
  chosen: string[]
}

function textStart(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text
}

export function StandardPicker({
  target,
  reference,
  onPick,
  onClose,
}: {
  target: PickerTarget
  reference: StandardRef[]
  onPick: (code: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const pool = useMemo(
    () =>
      reference.filter((standard) =>
        target.group === 'eldStandards'
          ? standard.framework === 'CA_ELD'
          : standard.framework !== 'CA_ELD',
      ),
    [reference, target.group],
  )
  const options = useMemo(
    () => searchStandards(pool, query, { exclude: target.chosen }),
    [pool, query, target.chosen],
  )

  const rect = target.anchor.getBoundingClientRect()
  const position = { left: rect.left + window.scrollX, top: rect.top + window.scrollY - 2 }

  useEffect(() => {
    inputRef.current?.focus()
    function onPointer(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [onClose])

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[active]
      if (option) onPick(option.code)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const optionId = (index: number) => `${listId}-${index}`

  return createPortal(
    <div className="std-picker" ref={panelRef} style={position}>
      <input
        ref={inputRef}
        className="input std-input"
        role="combobox"
        aria-label="Find a standard"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={options[active] ? optionId(active) : undefined}
        placeholder="Code or word"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      <div className="float std-results">
        {options.length > 0 ? (
          <div id={listId} role="listbox" aria-label="Standards">
            {options.map((option, index) => (
              <div
                key={option.code}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={`std-option${index === active ? ' on' : ''}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(option.code)}
              >
                <div className="row">
                  <b>{option.code}</b>
                  <span className="caption">{option.strand}</span>
                </div>
                <div className="std-text">{textStart(option.text)}</div>
              </div>
            ))}
          </div>
        ) : query.trim() ? (
          <p className="std-empty">No grade 6 standard matches “{query.trim()}”.</p>
        ) : null}
        <p className="caption std-help">
          Only codes from the grade 6 standards data can be added. Up and down to move, Enter to
          add.
        </p>
      </div>
    </div>,
    document.body,
  )
}
