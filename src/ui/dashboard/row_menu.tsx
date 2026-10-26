'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MoreIcon } from '../icons'

export type MenuEntry =
  | { kind: 'link'; label: string; href: string; icon: ReactNode; disabled?: boolean }
  | { kind: 'action'; label: string; onSelect: () => void; icon: ReactNode; disabled?: boolean }
  | { kind: 'separator' }

/**
 * The row's "More actions for lesson N" menu (R11-row-actions): a button with
 * aria-haspopup="menu"; arrow keys move between items, Escape closes and returns focus.
 */
export function RowMenu({ label, entries }: { label: string; entries: MenuEntry[] }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function items(): HTMLElement[] {
    return [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
  }

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) {
      buttonRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!open) {
      return
    }
    items()[0]?.focus()
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      list[(index + 1) % list.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      list[(index - 1 + list.length) % list.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      list[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      list[list.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div className="menu-anchor">
      <button
        ref={buttonRef}
        type="button"
        className="btn quiet sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="float menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {entries.map((entry, index) => {
            if (entry.kind === 'separator') {
              return <div key={`sep-${index}`} className="sep" role="separator" />
            }
            if (entry.kind === 'link' && !entry.disabled) {
              return (
                <Link
                  key={entry.label}
                  className="mi"
                  role="menuitem"
                  tabIndex={-1}
                  href={entry.href}
                  onClick={() => setOpen(false)}
                >
                  {entry.icon}
                  {entry.label}
                </Link>
              )
            }
            return (
              <button
                key={entry.label}
                type="button"
                className="mi"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={entry.disabled || undefined}
                onClick={() => {
                  if (entry.disabled || entry.kind !== 'action') {
                    return
                  }
                  // Focus goes back to the button first, so a dialog this opens returns it there.
                  close(true)
                  entry.onSelect()
                }}
              >
                {entry.icon}
                {entry.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
