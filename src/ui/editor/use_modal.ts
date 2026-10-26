'use client'
// Shared modal behaviour for the editor's dialogs (D1/D2 of the M4 validation): focus starts inside,
// Tab and Shift+Tab stay inside, Escape closes from anywhere on the page (even when an error left
// focus on the body), and focus returns to the element that opened the dialog.
import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useModal(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { initialFocus?: RefObject<HTMLElement | null> } = {},
): { keepFocus(): void } {
  const close = useRef(onClose)
  const restore = useRef(true)
  useEffect(() => {
    close.current = onClose
  }, [onClose])

  const initial = options.initialFocus
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const first = initial?.current ?? dialog?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    function onKeyDown(event: KeyboardEvent) {
      const current = dialogRef.current
      if (!current) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const head = items[0]!
      const tail = items[items.length - 1]!
      const inside = current.contains(document.activeElement)
      if (event.shiftKey && (!inside || document.activeElement === head)) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && (!inside || document.activeElement === tail)) {
        event.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (restore.current && trigger?.isConnected) trigger.focus()
    }
  }, [dialogRef, initial])

  return {
    /** The caller moves focus itself on close (e.g. to a result); don't restore the trigger. */
    keepFocus() {
      restore.current = false
    },
  }
}
