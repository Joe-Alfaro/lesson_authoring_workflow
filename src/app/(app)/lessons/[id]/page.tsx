import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '../../../../auth/require_role'
import { ROLES } from '../../../../auth/roles'
import { getCollabUrl } from '../../../../config/env'
import { getDb } from '../../../../db/client'
import { lessonLabel } from '../../../../lesson/labels'
import { RetryGenerationButton } from '../../../../ui/editor/retry_generation'
import { LessonEditorPage } from '../../../../ui/editor/lesson_editor_page'
import { loadLessonPage, loadStandards } from '../../../../ui/lesson/load_lesson'
import { StatusPill } from '../../../../ui/lesson/status_pill'
import '../../../../ui/lesson/lesson.css'

export const dynamic = 'force-dynamic'

/** The lesson editor (R17, R18) for any signed-in role; approved lessons open read-only (R23). */
export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ROLES)
  const { id } = await params
  const db = getDb()
  const lesson = await loadLessonPage(db, id)
  if (!lesson) {
    notFound()
  }

  if (!lesson.content) {
    return (
      <div className="editor-page">
        <div className="lesson-bar">
          <Link className="btn quiet sm" href={`/units/${lesson.unitId}`}>
            Unit {lesson.unitNumber}
          </Link>
          <span className="muted" aria-hidden="true">
            /
          </span>
          <span className="t">{lessonLabel(lesson.number)}</span>
          <StatusPill status={lesson.status} />
          {lesson.provenance ? <span className="caption">{lesson.provenance}</span> : null}
          <span className="spacer" />
          {lesson.status === 'failed' ? (
            <span className="caption row save-state">Not generated</span>
          ) : null}
          {lesson.status === 'failed' && (user.role === 'author' || user.role === 'admin') ? (
            <RetryGenerationButton unitId={lesson.unitId} lessonId={lesson.id} />
          ) : null}
        </div>
        <main className="lv-wrap">
          <p className="notice info">
            {lesson.status === 'failed'
              ? 'Generation failed for this lesson. An author can retry it from here or from the unit page.'
              : 'This lesson hasn’t been generated yet. Generate it from the unit page, then edit it here.'}
          </p>
        </main>
      </div>
    )
  }

  const standards = await loadStandards(db)
  return (
    <LessonEditorPage
      lesson={{ ...lesson, content: lesson.content }}
      user={{ id: user.id, name: user.name, role: user.role }}
      collabUrl={getCollabUrl()}
      standards={standards}
    />
  )
}
