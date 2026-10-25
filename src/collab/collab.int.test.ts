import { HocuspocusProvider } from '@hocuspocus/provider'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import * as Y from 'yjs'
import { connectTestDb } from '../../tests/db'
import { signCollabToken } from '../auth/collab_token'
import { runMigrations } from '../db/migrate'
import { yjsDocuments } from '../db/schema'
import { lessonDocumentName } from '../editor/ydoc'
import { cleanWorkflowData, createTestUnit, createUser } from '../../tests/workflow_fixtures'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import { createYjsPersistence } from './persistence'
import { startCollabServer, type RunningCollab } from './server'

const SECRET = 'collab-test-secret'
// M3: only `lesson:<id>` documents of existing lessons are served, so the user and lesson are real.
const USER = {
  id: '',
  email: 'wf-test-collab@example.com',
  name: 'Workflow collab',
  role: 'reviewer' as const,
}

type Outcome = 'authenticated' | 'denied'

/** Connects a real provider, edits the document and resolves with how authentication ended. */
function connect(url: string, name: string, token: string | null) {
  const document = new Y.Doc()
  let provider: HocuspocusProvider | undefined
  const outcome = new Promise<Outcome>((resolve) => {
    provider = new HocuspocusProvider({
      url,
      name,
      document,
      token,
      onAuthenticated: () => resolve('authenticated'),
      onAuthenticationFailed: () => resolve('denied'),
    })
  })
  return {
    outcome,
    close() {
      provider?.destroy()
    },
  }
}

describe('collab process', () => {
  const { pool, db } = connectTestDb()
  let collab: RunningCollab
  let wsUrl: string
  let lessonId: string

  beforeAll(async () => {
    await runMigrations(pool)
    USER.id = (await createUser(db, 'reviewer', 'collab')).id
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 1, content: richLessonContent() }],
    })
    lessonId = unit.lessonIds[0]!
    collab = await startCollabServer({
      databaseUrl: inject('databaseUrl'),
      port: 0,
      authSecret: SECRET,
    })
    wsUrl = collab.url.replace('http://', 'ws://')
  })
  afterAll(async () => {
    await collab.stop()
    await cleanWorkflowData(db)
    await pool.end()
  })

  it('serves GET /health with 200 when the database is reachable', async () => {
    const response = await fetch(`${collab.url}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', database: 'up' })
  })

  it('rejects connections without a valid token and stores nothing for them', async () => {
    const name = lessonDocumentName(lessonId)
    const attempts = [
      connect(wsUrl, name, null),
      connect(wsUrl, name, 'v1.not.valid'),
      connect(wsUrl, name, signCollabToken(USER, 'another-secret')),
      connect(wsUrl, name, signCollabToken(USER, SECRET, { now: 0 })),
    ]
    const outcomes = await Promise.all(attempts.map((attempt) => attempt.outcome))
    expect(outcomes).toEqual(['denied', 'denied', 'denied', 'denied'])
    attempts.forEach((attempt) => attempt.close())

    // Denied connections never load the document, so nothing is stored for it.
    const rows = await db
      .select({ name: yjsDocuments.name })
      .from(yjsDocuments)
      .where(eq(yjsDocuments.name, name))
    expect(rows).toEqual([])

    const allowed = connect(wsUrl, name, signCollabToken(USER, SECRET))
    expect(await allowed.outcome).toBe('authenticated')
    allowed.close()
  })

  it('persists Yjs document state in Postgres', async () => {
    const persistence = createYjsPersistence(db)
    expect(await persistence.fetch('lesson:missing')).toBeNull()

    await persistence.store('lesson:abc', new Uint8Array([1, 2, 3]))
    await persistence.store('lesson:abc', new Uint8Array([4, 5]))

    expect(await persistence.fetch('lesson:abc')).toEqual(new Uint8Array([4, 5]))
  })
})
