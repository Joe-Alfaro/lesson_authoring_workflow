/** Line icons from the mockups (16px grid, stroke 1.6); all decorative, so aria-hidden. */
import type { ReactNode } from 'react'

function LineIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function UploadIcon() {
  return (
    <LineIcon>
      <path d="M8 10.5V2.5M4.8 5.5L8 2.3l3.2 3.2" />
      <path d="M2.5 10.5v3h11v-3" />
    </LineIcon>
  )
}

export function LinkIcon() {
  return (
    <LineIcon>
      <path d="M6.8 9.2a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.8.8" />
      <path d="M9.2 6.8a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.8-.8" />
    </LineIcon>
  )
}

export function FileIcon() {
  return (
    <LineIcon>
      <path d="M4 1.8h5.2L12.5 5v9.2H4z" />
      <path d="M9 1.8V5h3.5" />
    </LineIcon>
  )
}

export function CheckIcon() {
  return (
    <LineIcon>
      <path d="M3 8.5l3.2 3L13 4.5" />
    </LineIcon>
  )
}

export function CircleIcon() {
  return (
    <LineIcon>
      <circle cx="8" cy="8" r="5.5" />
    </LineIcon>
  )
}

/** Warning (import, standards): triangle outline. */
export function WarningIcon() {
  return (
    <LineIcon>
      <path d="M8 2l6.3 11.3H1.7z" />
      <path d="M8 6.3v3.2M8 11.4v.1" />
    </LineIcon>
  )
}

/** Error: filled triangle. */
export function ErrorIcon() {
  return (
    <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.8l6.6 11.7H1.4z" fill="currentColor" />
      <path d="M8 6v3.6M8 11.4v.1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
