import { notFound } from 'next/navigation'
import { requireRole } from '../../../../auth/require_role'
import { ROLES } from '../../../../auth/roles'
import { getCollabUrl } from '../../../../config/env'
import { getDb } from '../../../../db/client'
import { lessonLabel } from '../../../../lesson/labels'
import { PendingLessonPage } from '../../../../ui/editor/pending_lesson_page'
import { LessonEditorPage } from '../../../../ui/editor/lesson_editor_page'
import { loadLessonPage, loadStandards } from '../../../../ui/lesson/load_lesson'
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
      <PendingLessonPage
        lesson={lesson}
        label={lessonLabel(lesson.number)}
        canRetry={user.role === 'author' || user.role === 'admin'}
      />
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
