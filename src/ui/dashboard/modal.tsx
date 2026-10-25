'use client'

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  role: 'dialog' | 'alertdialog'
  labelledBy: string
  describedBy?: string
  /** The safe button (Cancel, Keep running) that gets focus first. */
  initialFocus: RefObject<HTMLElement | null>
  onClose: () => void
  width?: number
  children: ReactNode
}

/**
 * A modal dialog (docs/design/lesson-authoring.md, Accessibility): focus starts on the safe
 * button, Tab stays inside, Escape closes, and focus returns to the trigger when it closes.
 */
export function Modal({
  role,
  labelledBy,
  describedBy,
  initialFocus,
  onClose,
  width,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) {
      return
    }
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) {
      dialog.showModal()
    }
    initialFocus.current?.focus()
    return () => {
      if (dialog.open) {
        dialog.close()
      }
      trigger?.focus()
    }
  }, [initialFocus])

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !ref.current) {
      return
    }
    const focusable = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusable.length === 0) {
      return
    }
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && (active === first || !ref.current.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !ref.current.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      style={width ? { width } : undefined}
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        // The browser's own Escape handling; close through the owner instead.
        event.preventDefault()
        onClose()
      }}
    >
      {children}
    </dialog>
  )
}
