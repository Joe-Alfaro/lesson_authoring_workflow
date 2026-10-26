'use client'

import { useEffect, useRef } from 'react'
import type { StandardRef } from '../../editor/standards'
import { WarningIcon } from '../icons'
import { bindStandardChip, setStandardReference } from './standard_tooltip'

/** Hands the page's reference standards to the shared tooltip (R15). */
export function StandardReference({ standards }: { standards: StandardRef[] }) {
  useEffect(() => setStandardReference(standards), [standards])
  return null
}

/** A standard code chip; hover or focus shows its full text (R15). */
export function StandardChip({ code, known }: { code: string; known: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => (ref.current ? bindStandardChip(ref.current, code) : undefined), [code])
  return (
    <button ref={ref} type="button" className={`chip chipbtn${known ? '' : ' warn'}`}>
      {known ? null : <WarningIcon />}
      {code}
    </button>
  )
}

/**
 * A standard code inside the lesson body (part tags, pulse checks, rubrics): same popover, named
 * apart from the front-matter chips (the lesson's own standards list).
 */
export function CodeChip({ code, className = 'chip sm' }: { code: string; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => (ref.current ? bindStandardChip(ref.current, code) : undefined), [code])
  return (
    <button
      ref={ref}
      type="button"
      className={`${className} code-chip`}
      aria-label={`Standard ${code}`}
    >
      {code}
    </button>
  )
}
