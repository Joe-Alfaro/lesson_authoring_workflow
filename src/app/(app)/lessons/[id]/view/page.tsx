import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../../../db/client'
import { lessonLabel } from '../../../../../lesson/labels'
import { HtmlButton } from '../../../../../ui/lesson/html_button'
import { Icon } from '../../../../../ui/lesson/lesson_icons'
import { LessonView, SectionJump } from '../../../../../ui/lesson/lesson_view'
import { lessonCodes, loadLessonPage, loadStandards } from '../../../../../ui/lesson/load_lesson'
import { StandardReference } from '../../../../../ui/lesson/standard_chip'
import { StatusPill } from '../../../../../ui/lesson/status_pill'
import '../../../../../ui/lesson/lesson.css'

export const dynamic = 'force-dynamic'

/** R19: the read-only lesson view for any signed-in role. */
export default async function LessonViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const lesson = await loadLessonPage(db, id)
  if (!lesson) {
    notFound()
  }
  const label = lessonLabel(lesson.number)
  const standards = lesson.content ? await loadStandards(db, lessonCodes(lesson.content)) : []

  return (
    <div className="lv-page">
      <div className="lesson-bar">
        <Link className="btn quiet sm" href={`/units/${lesson.unitId}`}>
          Unit {lesson.unitNumber}
        </Link>
        <span className="muted" aria-hidden="true">
          /
        </span>
        <span className="t">{label}</span>
        <StatusPill status={lesson.status} />
        <span className="spacer" />
        <span className="caption hide-m">Read-only view</span>
        {lesson.content ? <HtmlButton lessonId={lesson.id} /> : null}
        <Link className="btn sm primary" href={`/lessons/${lesson.id}`}>
          <Icon name="pencil" />
          Open editor
        </Link>
      </div>
      {lesson.content ? (
        <>
          <StandardReference standards={standards} />
          <SectionJump content={lesson.content} />
          <div className="lv-wrap lv">
            <LessonView
              content={lesson.content}
              unitNumber={lesson.unitNumber}
              knownCodes={new Set(standards.map((standard) => standard.code))}
            />
          </div>
        </>
      ) : (
        <div className="lv-wrap">
          <p className="notice info">This lesson hasn’t been generated yet.</p>
        </div>
      )}
    </div>
  )
}
