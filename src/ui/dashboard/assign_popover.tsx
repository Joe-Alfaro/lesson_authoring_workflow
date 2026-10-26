'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { avatarColour, initials } from '../avatar'
import { SearchIcon } from '../icons'

export interface Reviewer {
  id: string
  name: string
  openAssignments: number
}

interface AssignPopoverProps {
  /** "Assign 6 lessons" or "Assign lesson 30". */
  title: string
  lessonCount: number
  onAssign: (reviewer: Reviewer) => void
  onClose: () => void
  /** Set while the assignment is being saved: the list stays open and can't be used. */
  saving?: boolean
  /** Shown below the list when saving failed. */
  error?: string | null
  /**
   * Render in document.body under this element (a row's menu button) instead of in place, so the
   * list is not part of the table row.
   */
  anchor?: HTMLElement | null
}

/** Page coordinates under the right edge of `anchor`. */
function placeUnder(anchor: HTMLElement): { top: number; right: number } {
  const box = anchor.getBoundingClientRect()
  return {
    top: box.bottom + window.scrollY + 4,
    right: document.documentElement.clientWidth - box.right - window.scrollX,
  }
}

/**
 * R25: a searchable reviewer list with each reviewer's current load (R25-bulk-assign). Picking a
 * reviewer assigns the lessons; the owner closes it once that is saved. Escape closes without
 * assigning.
 */
export function AssignPopover({
  title,
  lessonCount,
  onAssign,
  onClose,
  saving = false,
  error,
  anchor,
}: AssignPopoverProps) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    // Positioned on the DOM node itself: it only depends on where the anchor is on screen.
    if (anchor && ref.current) {
      const { top, right } = placeUnder(anchor)
      ref.current.style.top = `${top}px`
      ref.current.style.right = `${right}px`
    }
  }, [anchor])

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    inputRef.current?.focus()
    let cancelled = false
    fetch('/api/reviewers')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('The reviewer list could not be loaded. Try again.')
        }
        const body = (await response.json()) as { reviewers: Reviewer[] }
        if (!cancelled) {
          // Least loaded first, so work spreads across reviewers.
          setReviewers(
            [...body.reviewers].sort(
              (a, b) => a.openAssignments - b.openAssignments || a.name.localeCompare(b.name),
            ),
          )
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoadError(caught instanceof Error ? caught.message : String(caught))
        }
      })
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        onCloseRef.current()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      cancelled = true
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  const matches = (reviewers ?? []).filter((reviewer) =>
    reviewer.name.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const current = matches[Math.min(active, matches.length - 1)]

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && current && !saving) {
      event.preventDefault()
      onAssign(current)
    }
  }

  const popover = (
    <div
      ref={ref}
      className={`float assign${anchor ? ' anchored' : ''}`}
      role="dialog"
      aria-label={title}
      aria-busy={saving || undefined}
      onKeyDown={onKeyDown}
    >
      <div className="search">
        <SearchIcon />
        <input
          ref={inputRef}
          className="input"
          type="text"
          aria-label="Find a reviewer"
          aria-controls={`${id}-list`}
          aria-activedescendant={current ? `${id}-${current.id}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
        />
      </div>
      {loadError ? (
        <p className="errmsg" role="alert">
          {loadError}
        </p>
      ) : null}
      {reviewers === null && !loadError ? <p className="caption">Loading reviewers...</p> : null}
      {reviewers !== null && matches.length === 0 ? (
        <p className="caption">No reviewer matches &quot;{query}&quot;.</p>
      ) : null}
      {/* Focusable, so the scrolling list is reachable by keyboard: arrows move, Enter assigns. */}
      <ul
        className="options"
        role="listbox"
        id={`${id}-list`}
        aria-label="Reviewers"
        tabIndex={0}
        aria-activedescendant={current ? `${id}-${current.id}` : undefined}
      >
        {matches.map((reviewer) => (
          <li
            key={reviewer.id}
            id={`${id}-${reviewer.id}`}
            role="option"
            aria-selected={reviewer === current}
            className={`row option${reviewer === current ? ' on' : ''}`}
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) {
                onAssign(reviewer)
              }
            }}
          >
            <span className={`av sm ${avatarColour(reviewer.id)}`} aria-hidden="true">
              {initials(reviewer.name)}
            </span>
            <span>{reviewer.name}</span>
            <span className="spacer" />
            <span className="caption">{reviewer.openAssignments} assigned</span>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="errmsg" role="alert">
          {error}
        </p>
      ) : null}
      <p className="caption note">
        {saving
          ? 'Assigning...'
          : `Assigning replaces the current assignee on ${lessonCount === 1 ? 'this lesson' : `all ${lessonCount} lessons`}.`}
      </p>
    </div>
  )
  return anchor ? createPortal(popover, document.body) : popover
}
