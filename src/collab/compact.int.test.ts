// Validation fix (M3): a lesson doc bloated by y-tiptap 3.0.10 position migration records is
// compacted (or rebuilt from its lesson) when the collab server loads it, so it opens fast again.
import { HocuspocusProvider } from '@hocuspocus/provider'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import * as Y from 'yjs'
import { connectTestDb } from '../../tests/db'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import { cleanWorkflowData, createTestUnit, createUser } from '../../tests/workflow_fixtures'
import { signCollabToken } from '../auth/collab_token'
import { runMigrations } from '../db/migrate'
import { yjsDocuments } from '../db/schema'
import { lessonDocumentName, lessonToYDoc, yDocToLesson } from '../editor/ydoc'
import { createYjsPersistence } from './persistence'
import { startCollabServer, type RunningCollab } from './server'

const SECRET = 'compact-test-secret'

function bloat(doc: Y.Doc, records: number): void {
  const store = doc.getMap('__tiptap_position_migrations:root:default')
  doc.transact(() => {
    Array.from({ length: records }).forEach((_, index) => {
      store.set(`${doc.clientID}:${index}`, {
        version: 1,
        seen: [[doc.clientID, index]],
        transfers: Array.from({ length: 30 }, (_unused, n) => ({
          source: { clock: n },
          target: n,
        })),
      })
    })
  })
}

describe('collab server compacts bloated lesson docs on load', () => {
  const { pool, db } = connectTestDb()
  let collab: RunningCollab
  let token: string

  beforeAll(async () => {
    await runMigrations(pool)
    const user = await createUser(db, 'reviewer', 'compact')
    token = signCollabToken({ ...user, email: 'wf-test-compact@example.com' }, SECRET)
    collab = await startCollabServer({
      databaseUrl: inject('databaseUrl'),
      port: 0,
      authSecret: SECRET,
    })
  })
  afterAll(async () => {
    await collab.stop()
    await cleanWorkflowData(db)
    await pool.end()
  })

  async function storedSize(name: string): Promise<number> {
    const [row] = await db.select().from(yjsDocuments).where(eq(yjsDocuments.name, name))
    return row!.state.byteLength
  }

  async function open(name: string): Promise<{ doc: Y.Doc; close(): void }> {
    const doc = new Y.Doc()
    let provider!: HocuspocusProvider
    await new Promise<void>((resolve) => {
      provider = new HocuspocusProvider({
        url: collab.url.replace('http://', 'ws://'),
        name,
        document: doc,
        token,
        onSynced: () => resolve(),
      })
    })
    return { doc, close: () => provider.destroy() }
  }

  it.each([
    ['a few records (pruned in place)', 300],
    ['many records (rebuilt from the lesson)', 20_000],
  ])('opens a doc with %s at close to its content size', async (_, records) => {
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 1, content: richLessonContent() }],
    })
    const name = lessonDocumentName(unit.lessonIds[0]!)
    const fresh = Y.encodeStateAsUpdate(lessonToYDoc(richLessonContent())).byteLength
    const bloated = lessonToYDoc(richLessonContent())
    bloat(bloated, records)
    await createYjsPersistence(db).store(name, Y.encodeStateAsUpdate(bloated))
    expect(await storedSize(name)).toBeGreaterThan(fresh * 5)

    const client = await open(name)
    expect(yDocToLesson(client.doc)).toEqual({ ok: true, lesson: richLessonContent() })
    expect(await storedSize(name)).toBeLessThan(fresh * 3)
    client.close()
  })
})
