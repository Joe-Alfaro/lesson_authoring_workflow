'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** How often the page re-reads while a run is going, in case an event was missed. */
const POLL_MS = 4_000
/** Events come in bursts (a run start queues 41 lessons); one refresh covers a burst. */
const DEBOUNCE_MS = 150

/**
 * R9: re-renders the unit page from the server when the generation feed
 * (/api/units/:id/generation/events) reports a status change, without reloading the page.
 * While `active`, it also re-reads every few seconds so the run's own status and cost are
 * picked up even when no lesson changes.
 */
export function useLiveRefresh(unitId: string, active: boolean): void {
  const router = useRouter()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function refreshSoon() {
      clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), DEBOUNCE_MS)
    }
    const source = new EventSource(`/api/units/${unitId}/generation/events`)
    let opened = false
    source.onopen = () => {
      // A reconnect may have missed events; the first open is what the page was rendered from.
      if (opened) {
        refreshSoon()
      }
      opened = true
    }
    source.onmessage = (event: MessageEvent<string>) => {
      if (!event.data.includes('"type":"snapshot"')) {
        refreshSoon()
      }
    }
    return () => {
      clearTimeout(timer)
      source.close()
    }
  }, [unitId, router])

  useEffect(() => {
    if (!active) {
      return
    }
    const interval = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(interval)
  }, [active, router])
}
