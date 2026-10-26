'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** How often the page re-reads while a run is going or waits on its cap, in case an event was missed. */
const POLL_MS = 2_500
/** Events come in bursts (a run start queues 41 lessons); one refresh covers a burst. */
const DEBOUNCE_MS = 150

/**
 * R9: re-renders the unit page from the server when the generation feed
 * (/api/units/:id/generation/events) reports a status change, without reloading the page.
 * While `poll` (a run is going, or stopped at its cap), it also re-reads every few seconds so the
 * run's own status, cost and cap are picked up even when no lesson changes (a cap raised by an
 * admin elsewhere sends no lesson event).
 */
export function useLiveRefresh(unitId: string, poll: boolean): void {
  const router = useRouter()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function refreshSoon() {
      clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), DEBOUNCE_MS)
    }
    const source = new EventSource(`/api/units/${unitId}/generation/events`)
    // Every message triggers a re-read, the first snapshot included: a change made while the
    // page was loading and the feed was connecting is only in that snapshot.
    source.onmessage = () => refreshSoon()
    return () => {
      clearTimeout(timer)
      source.close()
    }
  }, [unitId, router])

  useEffect(() => {
    if (!poll) {
      return
    }
    const interval = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(interval)
  }, [poll, router])
}
