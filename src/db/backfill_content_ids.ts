// One-time data backfill (N1 of the M4 re-validation): lessons generated before ids were assigned
// at save time get ids. A lesson whose editor document is already stored adopts the ids that
// document made up, so lessons.content and the Yjs document agree; others get fresh ids.
// Idempotent; run by migrate_cli after the schema migrations.
import { eq, isNotNull } from 'drizzle-orm'
import { isDeepStrictEqual } from 'node:util'
import * as Y from 'yjs'
import { lessonDocumentName } from '../editor/document_name'
import { yDocToLesson } from '../editor/ydoc'
import { hasContentIds, withContentIds } from '../lesson/content_ids'
import { LessonContent } from '../lesson/schema'
import type { Database } from './client'
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

/** The stored editor document's lesson, when it is the same lesson apart from ids. */
async function editorIds(
  db: Database,
  lessonId: string,
  content: LessonContent,
): Promise<LessonContent | null> {
  const [row] = await db
    .select({ state: yjsDocuments.state })
    .from(yjsDocuments)
    .where(eq(yjsDocuments.name, lessonDocumentName(lessonId)))
  if (!row) return null
  const doc = new Y.Doc()
  Y.applyUpdate(doc, row.state)
  const snapshot = yDocToLesson(doc)
  if (!snapshot.ok || !hasContentIds(snapshot.lesson)) return null
  return isDeepStrictEqual(withoutIds(snapshot.lesson), withoutIds(content))
    ? snapshot.lesson
    : null
}

export async function backfillContentIds(db: Database): Promise<{ updated: number }> {
  const rows = await db
    .select({ id: lessons.id, content: lessons.content })
    .from(lessons)
    .where(isNotNull(lessons.content))
  let updated = 0
  for (const row of rows) {
    const parsed = LessonContent.safeParse(row.content)
    if (!parsed.success || hasContentIds(parsed.data)) continue
    const content = (await editorIds(db, row.id, parsed.data)) ?? withContentIds(parsed.data)
    await db.update(lessons).set({ content }).where(eq(lessons.id, row.id))
    updated += 1
  }
  return { updated }
}
