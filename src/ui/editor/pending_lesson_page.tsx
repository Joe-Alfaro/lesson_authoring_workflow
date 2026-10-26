'use client'
// A lesson with no content yet (never generated, generating, or failed). It follows the status live
// like the editor (2 s poll) and turns into the editor once generation produces a Draft (N2 of the
// M4 re-validation). Retry generation is disabled while the lesson is generating.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import type { LessonStatus } from '../../db/schema'
import { StatusPill } from '../lesson/status_pill'
import { RetryGenerationButton } from './retry_generation'
import { useLiveStatus } from './use_live_status'

export function PendingLessonPage({
  lesson,
  label,
  canRetry,
}: {
  lesson: {
    id: string
    unitId: string
    unitNumber: number
    status: LessonStatus
    provenance: string | null
  }
  label: string
  canRetry: boolean
}) {
  const router = useRouter()
  // A new status may come with content: the server page then renders the editor instead.
  const refresh = useCallback(() => router.refresh(), [router])
  const [status, setStatus] = useLiveStatus(lesson.id, lesson.status, refresh)

  let message =
    'This lesson hasn’t been generated yet. Generate it from the unit page, then edit it here.'
  if (status === 'failed') {
    message =
      'Generation failed for this lesson. An author can retry it from here or from the unit page.'
  } else if (status === 'generating') {
    message = 'This lesson is being generated. It opens for editing when generation finishes.'
  }

  return (
    <div className="editor-page">
      <div className="lesson-bar">
        <Link className="btn quiet sm" href={`/units/${lesson.unitId}`}>
          Unit {lesson.unitNumber}
        </Link>
        <span className="muted" aria-hidden="true">
          /
        </span>
        <span className="t">{label}</span>
        <StatusPill status={status} />
        {lesson.provenance ? <span className="caption">{lesson.provenance}</span> : null}
        <span className="spacer" />
        {status === 'failed' ? <span className="caption row save-state">Not generated</span> : null}
        {status === 'generating' ? (
          <span className="caption row save-state">Generating sections</span>
        ) : null}
        {canRetry && (status === 'failed' || status === 'generating') ? (
          <RetryGenerationButton
            unitId={lesson.unitId}
            lessonId={lesson.id}
            disabled={status === 'generating'}
            onStarted={() => setStatus('generating')}
          />
        ) : null}
      </div>
      <main className="lv-wrap">
        <p className="notice info" role="status">
          {message}
        </p>
      </main>
    </div>
  )
}
