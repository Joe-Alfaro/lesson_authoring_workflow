'use client'
// R23 live status (D-050): the editor polls GET /api/lessons/:id/status every 2 s with the last
// ETag, so a status change (approve locks, reopen unlocks) reaches every open editor within a few
// seconds without holding a connection per tab. Paused while the tab is hidden; checks at once
// when the tab becomes visible or gets focus.
import { useEffect, useRef, useState } from 'react'
import type { LessonStatus } from '../../db/schema'

export const STATUS_POLL_MS = 2_000

export function useLiveStatus(lessonId: string, initial: LessonStatus, onChange: () => void) {
  const [status, setStatus] = useState(initial)
  // A server refresh brings a newer status in props; it wins over the last polled one.
  const [fromServer, setFromServer] = useState(initial)
  if (fromServer !== initial) {
    setFromServer(initial)
    setStatus(initial)
  }
  const known = useRef(status)
  const changed = useRef(onChange)
  useEffect(() => {
    known.current = status
  }, [status])
  useEffect(() => {
    changed.current = onChange
  }, [onChange])

  useEffect(() => {
    let etag: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    let stopped = false

    async function check() {
      if (inFlight || stopped) return
      inFlight = true
      try {
        const response = await fetch(`/api/lessons/${lessonId}/status`, {
          cache: 'no-store',
          headers: etag ? { 'If-None-Match': etag } : undefined,
        })
        if (response.status !== 200) return
        etag = response.headers.get('ETag')
        const body = (await response.json()) as { status: LessonStatus }
        if (!stopped && body.status !== known.current) {
          known.current = body.status
          setStatus(body.status)
          changed.current()
        }
      } catch {
        // Offline for a moment: the next tick tries again.
      } finally {
        inFlight = false
      }
    }

    function schedule() {
      clearTimeout(timer)
      if (stopped || document.hidden) return
      timer = setTimeout(() => {
        void check().finally(schedule)
      }, STATUS_POLL_MS)
    }

    function wake() {
      if (document.hidden) {
        clearTimeout(timer)
        return
      }
      void check().finally(schedule)
    }

    schedule()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [lessonId])

  return [status, setStatus] as const
}
