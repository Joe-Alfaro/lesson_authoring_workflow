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

export function PencilIcon() {
  return (
    <LineIcon>
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    </LineIcon>
  )
}

export function EyeIcon() {
  return (
    <LineIcon>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </LineIcon>
  )
}

/** Changes requested: an editor's pen mark. */
export function PenMarkIcon() {
  return (
    <LineIcon>
      <path d="M2 12c2-1 3-4 5-4s1 3 3 3 3-3 4-4" />
      <path d="M2 14.5h12" />
    </LineIcon>
  )
}

export function ClockIcon() {
  return (
    <LineIcon>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </LineIcon>
  )
}

export function RetryIcon() {
  return (
    <LineIcon>
      <path d="M13.2 6.5A5.5 5.5 0 003.3 5" />
      <path d="M2.8 9.5a5.5 5.5 0 009.9 1.5" />
      <path d="M3 2.3V5h2.7M13 13.7V11h-2.7" />
    </LineIcon>
  )
}

export function PlayIcon() {
  return (
    <LineIcon>
      <path d="M4.5 2.8v10.4L13 8z" />
    </LineIcon>
  )
}

export function StopIcon() {
  return (
    <LineIcon>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </LineIcon>
  )
}

export function DownloadIcon() {
  return (
    <LineIcon>
      <path d="M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2" />
      <path d="M2.5 11v2.5h11V11" />
    </LineIcon>
  )
}

export function SearchIcon() {
  return (
    <LineIcon>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4L14 14" />
    </LineIcon>
  )
}

export function ChevronDownIcon() {
  return (
    <LineIcon>
      <path d="M4.5 6.5L8 10l3.5-3.5" />
    </LineIcon>
  )
}

export function MoreIcon() {
  return (
    <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
    </svg>
  )
}

export function PersonIcon() {
  return (
    <LineIcon>
      <circle cx="8" cy="5.5" r="2.8" />
      <path d="M2.5 14c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
    </LineIcon>
  )
}

export function FilterIcon() {
  return (
    <LineIcon>
      <path d="M2 3h12L9.5 8.5V13l-3-1.5v-3z" />
    </LineIcon>
  )
}

export function HistoryIcon() {
  return (
    <LineIcon>
      <path d="M2.5 8a5.5 5.5 0 101.6-3.9" />
      <path d="M2.3 2.5v2.8h2.8" />
      <path d="M8 5v3.2l2 1.3" />
    </LineIcon>
  )
}
