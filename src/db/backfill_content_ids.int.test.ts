// N1 (M4 re-validation): a one-time backfill gives existing generated lessons ids. A lesson whose
// editor document is already stored takes the ids that document already has, so lessons.content
// and the Yjs document agree; others get fresh ids. Idempotent.
import { eq, sql } from 'drizzle-orm'
import * as Y from 'yjs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import { cleanWorkflowData, createTestUnit, lessonContent } from '../../tests/workflow_fixtures'
import { lessonDocumentName } from '../editor/document_name'
import { lessonToYDoc, yDocToLesson } from '../editor/ydoc'
import type { LessonContent } from '../lesson/schema'
import { backfillContentIds } from './backfill_content_ids'
import { runMigrations } from './migrate'
import { lessons, yjsDocuments } from './schema'

function withoutIds(content: LessonContent): LessonContent {
  const copy = structuredClone(content)
  copy.body.sections.forEach((section) => {
    delete section.id
    section.parts.forEach((part) => {
      delete part.id
      part.blocks.forEach((block) => delete block.id)
    })
  })
  return copy
}

function sectionIds(content: LessonContent) {
  return content.body.sections.map((section) => section.id)
}

describe('backfillContentIds', () => {
  const { pool, db } = connectTestDb()

  beforeAll(async () => {
    await runMigrations(pool)
  })
  beforeEach(async () => {
    await cleanWorkflowData(db)
    await db.execute(sql`DELETE FROM yjs_documents`)
  })
  afterAll(async () => {
    await cleanWorkflowData(db)
    await pool.end()
  })

  async function content(lessonId: string): Promise<LessonContent> {
    const [row] = await db
      .select({ content: lessons.content })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
    return row!.content as LessonContent
  }

  it('assigns ids, adopts the stored editor document ids, leaves the rest alone, and is idempotent', async () => {
    const unit = await createTestUnit(db, {
      lessons: [
        { lessonNumber: 1, content: withoutIds(richLessonContent()) },
        { lessonNumber: 2, content: withoutIds(richLessonContent()) },
        { lessonNumber: 3, content: richLessonContent() },
        { lessonNumber: 4, content: lessonContent('Not a valid lesson') },
        { lessonNumber: 5 },
      ],
    })
    const [fresh, opened, withIds, invalid] = unit.lessonIds as [string, string, string, string]
    // Lesson 2 was opened in the editor, which made up ids in its Yjs document.
    const doc = lessonToYDoc(withoutIds(richLessonContent()))
    await db.insert(yjsDocuments).values({
      name: lessonDocumentName(opened),
      state: Y.encodeStateAsUpdate(doc),
    })
    const docLesson = yDocToLesson(doc)
    if (!docLesson.ok) throw new Error('fixture doc does not convert')

    const first = await backfillContentIds(db)
    expect(first.updated).toBe(2)

    const freshContent = await content(fresh)
    expect(sectionIds(freshContent).every(Boolean)).toBe(true)
    expect(withoutIds(freshContent)).toEqual(withoutIds(richLessonContent()))

    expect(await content(opened)).toEqual(docLesson.lesson)
    expect(await content(withIds)).toEqual(richLessonContent())
    expect(await content(invalid)).toEqual(lessonContent('Not a valid lesson'))

    expect((await backfillContentIds(db)).updated).toBe(0)
  })
})
