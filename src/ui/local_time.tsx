'use client'
// Times shown in the viewer's time zone. The server doesn't know that zone, so these render an
// empty <time dateTime> on the server and during hydration, and fill in the text right after;
// formatting on both sides would differ whenever the zones differ (React error #418).
import { useSyncExternalStore } from 'react'

function subscribe(): () => void {
  return () => {}
}

/** False on the server and while hydrating, true after (and on client-side navigations). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}

interface LocalTimeProps {
  iso: string
  /** Formats `iso` in the viewer's time zone; runs only in the browser. */
  format: (iso: string) => string
}

export function LocalTime({ iso, format }: LocalTimeProps) {
  const hydrated = useHydrated()
  return <time dateTime={iso}>{hydrated ? format(iso) : null}</time>
}

/** "Mar 10, 2026" in the viewer's time zone (usable from server components). */
export function LocalDate({ iso }: { iso: string }) {
  return <LocalTime iso={iso} format={formatMediumDate} />
}

function formatMediumDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' })
}
