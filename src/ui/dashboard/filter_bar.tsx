'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDownIcon, FilterIcon, SearchIcon } from '../icons'

export interface FilterOption {
  value: string
  label: string
}

interface FilterSelectProps {
  label: string
  options: FilterOption[]
  selected: string[]
  /** Status takes several values; Arc and Assignee one. */
  multiple?: boolean
  onChange: (selected: string[]) => void
}

/** "Status All": a button that opens a listbox of options (R24 filters). */
function FilterSelect({ label, options, selected, multiple = false, onChange }: FilterSelectProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const value =
    selected.length === 0
      ? 'All'
      : options
          .filter((option) => selected.includes(option.value))
          .map((option) => option.label)
          .join(', ')

  useEffect(() => {
    if (!open) {
      return
    }
    listRef.current?.focus()
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function pick(option: FilterOption) {
    if (!multiple) {
      onChange(selected.includes(option.value) ? [] : [option.value])
      setOpen(false)
      buttonRef.current?.focus()
      return
    }
    onChange(
      selected.includes(option.value)
        ? selected.filter((item) => item !== option.value)
        : [...selected, option.value],
    )
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') {
        event.preventDefault()
        buttonRef.current?.focus()
      }
      setOpen(false)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if ((event.key === 'Enter' || event.key === ' ') && options[active]) {
      event.preventDefault()
      pick(options[active])
    }
  }

  return (
    <div className="fwrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`fsel${selected.length > 0 ? ' set' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
        <span className="v">{value}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <ul
          ref={listRef}
          className="float options fpop"
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          aria-activedescendant={`${id}-${active}`}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={selected.includes(option.value)}
              className={`option${index === active ? ' on' : ''}`}
              onClick={() => pick(option)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export interface Filters {
  search: string
  statuses: string[]
  arcs: string[]
  assignees: string[]
}

export const NO_FILTERS: Filters = { search: '', statuses: [], arcs: [], assignees: [] }

export function hasFilters(filters: Filters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.statuses.length > 0 ||
    filters.arcs.length > 0 ||
    filters.assignees.length > 0
  )
}

interface FilterBarProps {
  filters: Filters
  onChange: (filters: Filters) => void
  statusOptions: FilterOption[]
  arcOptions: FilterOption[]
  assigneeOptions: FilterOption[]
}

/** Search, Status, Arc and Assignee; at narrow widths the three selects fold under "Filters". */
export function FilterBar({
  filters,
  onChange,
  statusOptions,
  arcOptions,
  assigneeOptions,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      className={`filters${expanded ? ' expanded' : ''}`}
      role="search"
      aria-label="Filter lessons"
    >
      <div className="search">
        <SearchIcon />
        <input
          className="input"
          type="text"
          placeholder="Search lessons"
          aria-label="Search lessons"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
      </div>
      <button
        type="button"
        className="btn fbtn"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <FilterIcon />
        Filters
      </button>
      <div className="fsels">
        <FilterSelect
          label="Status"
          options={statusOptions}
          selected={filters.statuses}
          multiple
          onChange={(statuses) => onChange({ ...filters, statuses })}
        />
        <FilterSelect
          label="Arc"
          options={arcOptions}
          selected={filters.arcs}
          onChange={(arcs) => onChange({ ...filters, arcs })}
        />
        <FilterSelect
          label="Assignee"
          options={assigneeOptions}
          selected={filters.assignees}
          onChange={(assignees) => onChange({ ...filters, assignees })}
        />
        {hasFilters(filters) ? (
          <button type="button" className="btn quiet" onClick={() => onChange(NO_FILTERS)}>
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  )
}
