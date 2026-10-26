// Validation fix (M3): a collab store that runs after a restore committed, but before the collab
// server heard about it, must not write the pre-restore edits back. The restore deletes the
// lesson's Yjs row; a snapshot store writes only while that row exists (checked under the lesson
// row lock), so a store that lost the race changes nothing.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import { cleanWorkflowData, createTestUnit, createUser } from '../../tests/workflow_fixtures'
import { runMigrations } from '../db/migrate'
import { lessons, lessonVersions, yjsDocuments } from '../db/schema'
import { lessonDocumentName } from '../editor/document_name'
import { restoreVersion, saveEditorSnapshot } from './versions'

function edited(text: string) {
  const lesson = richLessonContent()
  lesson.body.title = text
  return lesson
}

describe('saveEditorSnapshot with the Yjs row as a fence', () => {
  const { pool, db } = connectTestDb()
  let userId: string

  beforeAll(async () => {
    await runMigrations(pool)
    userId = (await createUser(db, 'reviewer', 'snapshot-fence')).id
  })
  afterAll(async () => {
    await cleanWorkflowData(db)
    await pool.end()
  })

  async function setUp() {
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 1, content: richLessonContent() }],
    })
    const lessonId = unit.lessonIds[0]!
    const name = lessonDocumentName(lessonId)
    await db.insert(yjsDocuments).values({ name, state: new Uint8Array([1]) })
    return { lessonId, name }
  }

  it('stores the Yjs state and the content while the row exists', async () => {
    const { lessonId, name } = await setUp()
    const result = await saveEditorSnapshot(db, {
      lessonId,
      userId,
      content: edited('Edited title'),
      yjs: { name, state: new Uint8Array([7, 7]) },
    })
    expect(result).toEqual({ saved: true, replaced: false })
    const [row] = await db.select().from(yjsDocuments).where(eq(yjsDocuments.name, name))
    expect(row!.state).toEqual(new Uint8Array([7, 7]))
    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId))
    expect((lesson!.content as { body: { title: string } }).body.title).toBe('Edited title')
  })

  it('writes nothing after a restore removed the row (the store lost the race)', async () => {
    const { lessonId, name } = await setUp()
    await db
      .insert(lessonVersions)
      .values({ lessonId, content: richLessonContent(), authorId: null })
    const [version] = await db
      .select()
      .from(lessonVersions)
      .where(eq(lessonVersions.lessonId, lessonId))
    await restoreVersion(db, { lessonId, versionId: version!.id, userId })

    const result = await saveEditorSnapshot(db, {
      lessonId,
      userId,
      content: edited('Pre-restore edit'),
      yjs: { name, state: new Uint8Array([9]) },
    })
    expect(result).toEqual({ saved: false, replaced: true })
    expect(await db.select().from(yjsDocuments).where(eq(yjsDocuments.name, name))).toEqual([])
    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId))
    expect(lesson!.content).toEqual(richLessonContent())
  })
})
