import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../../db/client'
import { lessons, units } from '../../../../db/schema'
import { getLessonGeneration } from '../../../../generation/service'
import { isUuid } from '../../../../import/is_uuid'
import { StatusPill } from '../../../../ui/dashboard/status_pill'
import { PromptProvenance } from '../../../../ui/lesson/prompt_provenance'

export const dynamic = 'force-dynamic'

/**
 * Placeholder for the lesson editor (M3 replaces this page): the lesson bar with the back link,
 * lesson number, status and the prompt version and model it was generated with (R10).
 */
export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const [lesson] = isUuid(id)
    ? await db
        .select({
          id: lessons.id,
          unitId: lessons.unitId,
          unitNumber: units.unitNumber,
          lessonNumber: lessons.lessonNumber,
          status: lessons.status,
          content: lessons.content,
          description: lessons.description,
        })
        .from(lessons)
        .innerJoin(units, eq(units.id, lessons.unitId))
        .where(eq(lessons.id, id))
    : []
  if (!lesson) {
    notFound()
  }
  const generation = await getLessonGeneration(db, lesson.id)
  const title =
    (lesson.content as { body?: { title?: string } } | null)?.body?.title ??
    lesson.description.split('\n')[0]
  return (
    <>
      <div className="lesson-bar">
        <Link className="btn quiet sm" href={`/units/${lesson.unitId}`}>
          Unit {lesson.unitNumber}
        </Link>
        <span className="t">
          {lesson.lessonNumber === null ? 'Flex day' : `Lesson ${lesson.lessonNumber}`}
        </span>
        <StatusPill status={lesson.content ? lesson.status : 'not_generated'} />
        <PromptProvenance generation={generation} />
      </div>
      <main className="page">
        <h1 className="h1">{title}</h1>
      </main>
    </>
  )
}
