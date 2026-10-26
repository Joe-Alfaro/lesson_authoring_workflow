/** Line icons for lesson pages, from the mockups (16px grid, stroke 1.6); decorative. */
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

export const ICON_PATHS = {
  pencil: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  check: '<path d="M3 8.5l3.2 3L13 4.5"/>',
  cloud: '<path d="M4.5 12.5a3 3 0 01-.4-6A4 4 0 0111.8 6a3.2 3.2 0 01.2 6.5z"/>',
  history:
    '<path d="M2.5 8a5.5 5.5 0 101.6-3.9"/><path d="M2.3 2.5v2.8h2.8"/><path d="M8 5v3.2l2 1.3"/>',
  restore: '<path d="M3.5 6.5h6a3.5 3.5 0 010 7H6"/><path d="M6 3.5l-3 3 3 3"/>',
  lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.2 7V5a2.8 2.8 0 015.6 0v2"/>',
  info: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.9v.1"/>',
  target: '<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="2.4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  chevronDown: '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
  chevronRight: '<path d="M6.5 4.5L10 8l-3.5 3.5"/>',
  download: '<path d="M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2"/><path d="M2.5 11v2.5h11V11"/>',
  dot: '<circle cx="8" cy="8" r="5.5"/>',
  pen: '<path d="M3 13l2.5-.5L13 5l-2-2-7.5 7.5z"/><path d="M9 13h4"/>',
  sparkle:
    '<path d="M8 1.8l1.3 3.6 3.6 1.3-3.6 1.3L8 11.6 6.7 8 3.1 6.7l3.6-1.3z"/><path d="M12.6 11.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  refresh:
    '<path d="M13.2 6.5A5.5 5.5 0 003.3 5"/><path d="M2.8 9.5a5.5 5.5 0 009.9 1.5"/><path d="M3 2.3V5h2.7M13 13.7V11h-2.7"/>',
  warning: '<path d="M8 2l6.3 11.3H1.7z"/><path d="M8 6.3v3.2M8 11.4v.1"/>',
} as const

export type IconName = keyof typeof ICON_PATHS

/** An icon by name (the same markup the editor's plain DOM node views use). */
export function Icon({ name }: { name: IconName }) {
  return (
    <LineIcon>
      <g dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }} />
    </LineIcon>
  )
}

/** The same icon as an SVG string, for plain DOM. */
export function iconSvg(name: IconName): string {
  return `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`
}
