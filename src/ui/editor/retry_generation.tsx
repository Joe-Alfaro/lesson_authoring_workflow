'use client'
// R23-workflow-states "Failed (author)": Retry generation regenerates this one lesson with the
// unit's current prompt (the R11 regenerate route), so it moves to Generating.
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Icon } from '../lesson/lesson_icons'

export function RetryGenerationButton({
  unitId,
  lessonId,
  onStarted,
}: {
  unitId: string
  lessonId: string
  onStarted?: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function retry() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/units/${unitId}/generation/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A failed lesson has nothing worth keeping, so no overwrite question.
        body: JSON.stringify({ lessonIds: [lessonId], confirmOverwrite: true }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Could not start generation (${response.status}).`)
      }
      onStarted?.()
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void retry()}>
        <Icon name="refresh" />
        Retry generation
      </button>
      {error ? (
        <p className="notice err retry-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )
}
