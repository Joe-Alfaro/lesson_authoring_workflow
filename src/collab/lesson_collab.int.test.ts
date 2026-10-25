// M3 collab server against a real Postgres and real Hocuspocus providers (R14, R17, R18, R23 lock,
// D-021, D-024 (4), D-032 (1)). Contract: src/editor/README.md.
import { HocuspocusProvider } from '@hocuspocus/provider'
import { asc, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import * as Y from 'yjs'
import { connectTestDb } from '../../tests/db'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  type FixtureUser,
  type FixtureUsers,
} from '../../tests/workflow_fixtures'
import { signCollabToken } from '../auth/collab_token'
import { runMigrations } from '../db/migrate'
import { lessons, lessonVersions, yjsDocuments, type LessonStatus } from '../db/schema'
import { blockNodeName } from '../editor/schema'
import { lessonDocumentName, yDocToLesson } from '../editor/ydoc'
import type { LessonContent } from '../lesson/schema'
import { transitionLesson } from '../workflow/service'
import { restoreVersion } from '../workflow/versions'
import { startCollabServer, type RunningCollab } from './server'

const SECRET = 'lesson-collab-test-secret'
/** Short idle window so the test can watch a whole idle cycle (the unit test covers 30 s). */
const IDLE_MS = 1_500
const SAY_TEXT = 'Today we meet a narrator who says he is **not** a normal kid.'

type Outcome = { kind: 'synced'; scope: string | undefined } | { kind: 'denied'; reason: string }

interface Client {
  provider: HocuspocusProvider
  doc: Y.Doc
  outcome: Promise<Outcome>
  /** Sends {"type":"flush"} and resolves with the server's {"type":"flushed",...} answer. */
  flush(): Promise<{ type: 'flushed'; ok: boolean; reason?: string }>
  close(): void
}

function tokenFor(user: FixtureUser): string {
  return signCollabToken(
    { id: user.id, email: `${user.id}@example.com`, name: user.name, role: user.role },
    SECRET,
  )
}

function connect(url: string, name: string, token: string | null): Client {
  const doc = new Y.Doc()
  const waiting: ((payload: string) => void)[] = []
  let provider!: HocuspocusProvider
  const outcome = new Promise<Outcome>((resolve) => {
    provider = new HocuspocusProvider({
      url,
      name,
      document: doc,
      token,
      onSynced: () => resolve({ kind: 'synced', scope: provider.authorizedScope }),
      onAuthenticationFailed: ({ reason }) => resolve({ kind: 'denied', reason }),
      onStateless: ({ payload }) => waiting.shift()?.(payload),
    })
  })
  return {
    provider,
    doc,
    outcome,
    flush() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no flushed answer')), 10_000)
        waiting.push((payload) => {
          clearTimeout(timer)
          resolve(JSON.parse(payload) as { type: 'flushed'; ok: boolean; reason?: string })
        })
        provider.sendStateless(JSON.stringify({ type: 'flush' }))
      })
    },
    close() {
      provider.destroy()
    },
  }
}

/** The Y.XmlText of the first text inside the block element with this id. */
function blockText(doc: Y.Doc, blockType: 'say', id: string): Y.XmlText {
  const fragment = doc.getXmlFragment('default')
  for (const element of fragment.createTreeWalker(
    (node) =>
      node instanceof Y.XmlElement &&
      node.nodeName === blockNodeName(blockType) &&
      node.getAttribute('id') === id,
  )) {
    for (const inner of (element as Y.XmlElement).createTreeWalker((n) => n instanceof Y.XmlText)) {
      return inner as Y.XmlText
    }
  }
  throw new Error(`No ${blockType} block ${id} in the Yjs doc`)
}

function snapshot(doc: Y.Doc): LessonContent {
  const result = yDocToLesson(doc)
  if (!result.ok) throw new Error(`Invalid Yjs lesson: ${JSON.stringify(result.errors)}`)
  return result.lesson
}

function sayText(lesson: unknown): string | undefined {
  const block = (lesson as LessonContent | null)?.body.sections[0]?.parts[0]?.blocks[1]
  return block?.type === 'say' ? block.text : undefined
}

function withSay(text: string): LessonContent {
  const lesson = richLessonContent()
  const say = lesson.body.sections[0]!.parts[0]!.blocks[1]!
  if (say.type !== 'say') throw new Error('fixture changed')
  say.text = text
  return lesson
}

describe('lesson collaboration server', () => {
  const { pool, db } = connectTestDb()
  let users: FixtureUsers
  let collab: RunningCollab | undefined
  let wsUrl: string
  const clients: Client[] = []

  async function start() {
    collab = await startCollabServer({
      databaseUrl: inject('databaseUrl'),
      port: 0,
      authSecret: SECRET,
      versionIdleMs: IDLE_MS,
      storeDebounceMs: 50,
    })
    wsUrl = collab.url.replace('http://', 'ws://')
  }

  function open(lessonId: string, user: FixtureUser | null, token?: string | null): Client {
    const client = connect(
      wsUrl,
      lessonDocumentName(lessonId),
      token !== undefined ? token : user ? tokenFor(user) : null,
    )
    clients.push(client)
    return client
  }

  async function openSynced(lessonId: string, user: FixtureUser): Promise<Client> {
    const client = open(lessonId, user)
    expect(await client.outcome).toMatchObject({ kind: 'synced' })
    return client
  }

  async function createLesson(
    status: LessonStatus = 'draft',
    content: unknown = richLessonContent(),
  ) {
    const unit = await createTestUnit(db, { lessons: [{ lessonNumber: 4, status, content }] })
    return unit.lessonIds[0]!
  }

  async function lessonRow(id: string) {
    const [row] = await db.select().from(lessons).where(eq(lessons.id, id))
    return row!
  }

  async function versionsOf(id: string) {
    return db
      .select()
      .from(lessonVersions)
      .where(eq(lessonVersions.lessonId, id))
      .orderBy(asc(lessonVersions.createdAt))
  }

  beforeAll(async () => {
    await runMigrations(pool)
    await cleanWorkflowData(db)
    await db.delete(yjsDocuments)
    users = await createUsers(db)
  })
  beforeEach(async () => {
    await start()
  })
  afterEach(async () => {
    clients.splice(0).forEach((client) => client.close())
    await collab?.stop()
    collab = undefined
    await db.delete(yjsDocuments)
  })
  afterAll(async () => {
    await cleanWorkflowData(db)
    await pool.end()
  })

  it('seeds the Yjs document from lessons.content on first open', async () => {
    const lessonId = await createLesson()
    expect(
      await db
        .select()
        .from(yjsDocuments)
        .where(eq(yjsDocuments.name, lessonDocumentName(lessonId))),
    ).toEqual([])
    const client = await openSynced(lessonId, users.reviewer)
    expect(snapshot(client.doc)).toEqual(richLessonContent())
  })

  it('writes a validated snapshot of the Yjs doc back to lessons.content, without a version', async () => {
    const lessonId = await createLesson()
    const client = await openSynced(lessonId, users.reviewer)
    blockText(client.doc, 'say', 'b-say').insert(0, 'Hello. ')

    await expect
      .poll(async () => sayText((await lessonRow(lessonId)).content), { timeout: 5_000 })
      .toBe(`Hello. ${SAY_TEXT}`)
    const row = await lessonRow(lessonId)
    expect(row.content).toEqual(withSay(`Hello. ${SAY_TEXT}`))
    expect(row.lastEditedBy).toBe(users.reviewer.id)
    expect(row.status).toBe('draft')
    expect(await versionsOf(lessonId)).toEqual([])
  })

  it('a second user sees the first user’s edit (shared document)', async () => {
    const lessonId = await createLesson()
    const first = await openSynced(lessonId, users.reviewer)
    const second = await openSynced(lessonId, users.reviewer2)
    blockText(first.doc, 'say', 'b-say').insert(0, 'Shared. ')
    await expect
      .poll(() => sayText(snapshot(second.doc)), { timeout: 1_000 })
      .toBe(`Shared. ${SAY_TEXT}`)
  })

  it('concurrent inserts into the same paragraph keep both users’ text', async () => {
    const lessonId = await createLesson()
    const first = await openSynced(lessonId, users.reviewer)
    const second = await openSynced(lessonId, users.reviewer2)
    blockText(first.doc, 'say', 'b-say').insert(0, 'AAA ')
    blockText(second.doc, 'say', 'b-say').insert(0, 'BBB ')
    for (const client of [first, second]) {
      await expect
        .poll(() => sayText(snapshot(client.doc)), { timeout: 2_000 })
        .toMatch(/^(AAA BBB|BBB AAA) /)
    }
    expect(sayText(snapshot(first.doc))).toBe(sayText(snapshot(second.doc)))
  })

  it('creates a version only after the idle window, authored by the last editor', async () => {
    const lessonId = await createLesson()
    const client = await openSynced(lessonId, users.reviewer)
    const editedAt = Date.now()
    blockText(client.doc, 'say', 'b-say').insert(0, 'Idle. ')

    await new Promise((resolve) => setTimeout(resolve, IDLE_MS / 3))
    expect(await versionsOf(lessonId)).toEqual([])

    await expect.poll(async () => (await versionsOf(lessonId)).length, { timeout: 10_000 }).toBe(1)
    const [version] = await versionsOf(lessonId)
    expect(version!.authorId).toBe(users.reviewer.id)
    expect(version!.content).toEqual(withSay(`Idle. ${SAY_TEXT}`))
    expect(version!.createdAt.getTime() - editedAt).toBeGreaterThanOrEqual(IDLE_MS - 100)

    // No further edits: no further versions.
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 2))
    expect(await versionsOf(lessonId)).toHaveLength(1)
  })

  it('flush writes the latest edits now, so submit snapshots them as a version (no duplicate later)', async () => {
    const lessonId = await createLesson()
    const client = await openSynced(lessonId, users.reviewer)
    blockText(client.doc, 'say', 'b-say').insert(0, 'Before submit. ')
    expect(await client.flush()).toEqual({ type: 'flushed', ok: true })
    expect(sayText((await lessonRow(lessonId)).content)).toBe(`Before submit. ${SAY_TEXT}`)

    await transitionLesson(db, {
      lessonId,
      action: 'submit',
      actor: { id: users.reviewer.id, role: 'reviewer' },
    })
    const versions = await versionsOf(lessonId)
    expect(versions).toHaveLength(1)
    expect(versions[0]!.content).toEqual(withSay(`Before submit. ${SAY_TEXT}`))

    // The idle timer for the same content must not add a duplicate version.
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 2))
    expect(await versionsOf(lessonId)).toHaveLength(1)
  })

  it('keeps the last valid content when the Yjs doc stops validating, and stores it again once valid', async () => {
    const lessonId = await createLesson()
    const client = await openSynced(lessonId, users.reviewer)
    const text = blockText(client.doc, 'say', 'b-say')
    text.delete(0, text.length)
    expect(await client.flush()).toMatchObject({ type: 'flushed', ok: false, reason: 'invalid' })
    expect((await lessonRow(lessonId)).content).toEqual(richLessonContent())

    text.insert(0, 'Fixed.')
    expect(await client.flush()).toEqual({ type: 'flushed', ok: true })
    expect(sayText((await lessonRow(lessonId)).content)).toBe('Fixed.')
  })

  it('reopening after every editor closed (and a collab restart) shows the latest content', async () => {
    const lessonId = await createLesson()
    const client = await openSynced(lessonId, users.reviewer)
    blockText(client.doc, 'say', 'b-say').insert(0, 'Persisted. ')
    expect(await client.flush()).toEqual({ type: 'flushed', ok: true })
    client.close()
    await collab!.stop()
    await start()

    expect(
      await db
        .select()
        .from(yjsDocuments)
        .where(eq(yjsDocuments.name, lessonDocumentName(lessonId))),
    ).toHaveLength(1)
    const reopened = await openSynced(lessonId, users.reviewer2)
    expect(sayText(snapshot(reopened.doc))).toBe(`Persisted. ${SAY_TEXT}`)
  })

  it('restoring a version while editors are connected replaces their document', async () => {
    const lessonId = await createLesson()
    await db
      .insert(lessonVersions)
      .values({ lessonId, content: richLessonContent(), authorId: null })
    const [generated] = await versionsOf(lessonId)
    const first = await openSynced(lessonId, users.reviewer)
    const second = await openSynced(lessonId, users.reviewer2)
    blockText(first.doc, 'say', 'b-say').insert(0, 'Discard me. ')
    expect(await first.flush()).toEqual({ type: 'flushed', ok: true })

    await restoreVersion(db, { lessonId, versionId: generated!.id, userId: users.reviewer2.id })

    for (const client of [first, second]) {
      await expect.poll(() => sayText(snapshot(client.doc)), { timeout: 2_000 }).toBe(SAY_TEXT)
    }
    // The next store keeps the restored content rather than writing the old edit back.
    expect(await first.flush()).toEqual({ type: 'flushed', ok: true })
    expect((await lessonRow(lessonId)).content).toEqual(richLessonContent())
    // Restore saved the edited content first (D-024), then the restored one.
    const versions = await versionsOf(lessonId)
    expect(versions.map((v) => sayText(v.content))).toEqual([
      SAY_TEXT,
      `Discard me. ${SAY_TEXT}`,
      SAY_TEXT,
    ])
  })

  it('restoring a version while nobody is connected is what the next editor opens', async () => {
    const lessonId = await createLesson()
    await db
      .insert(lessonVersions)
      .values({ lessonId, content: richLessonContent(), authorId: null })
    const [generated] = await versionsOf(lessonId)
    const client = await openSynced(lessonId, users.reviewer)
    blockText(client.doc, 'say', 'b-say').insert(0, 'Old edit. ')
    expect(await client.flush()).toEqual({ type: 'flushed', ok: true })
    client.close()
    await collab!.stop()

    await restoreVersion(db, { lessonId, versionId: generated!.id, userId: users.reviewer.id })
    await start()
    const reopened = await openSynced(lessonId, users.reviewer)
    expect(snapshot(reopened.doc)).toEqual(richLessonContent())
  })

  it.each(['approved', 'generating'] as const)(
    'opens a %s lesson read-only and refuses its writes (D-032)',
    async (status) => {
      const lessonId = await createLesson(status)
      const client = open(lessonId, users.reviewer)
      expect(await client.outcome).toEqual({ kind: 'synced', scope: 'readonly' })
      expect(snapshot(client.doc)).toEqual(richLessonContent())

      blockText(client.doc, 'say', 'b-say').insert(0, 'Not allowed. ')
      expect(await client.flush()).toMatchObject({ type: 'flushed', ok: false, reason: 'locked' })
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS + 500))

      const row = await lessonRow(lessonId)
      expect(row.content).toEqual(richLessonContent())
      expect(row.lastEditedBy).toBeNull()
      expect(await versionsOf(lessonId)).toEqual([])
      const other = await openSynced(lessonId, users.reviewer2)
      expect(snapshot(other.doc)).toEqual(richLessonContent())
    },
  )

  it('stops accepting writes when the lesson is approved while an editor is connected', async () => {
    const lessonId = await createLesson('in_review')
    const client = await openSynced(lessonId, users.approver)
    blockText(client.doc, 'say', 'b-say').insert(0, 'Approved text. ')
    expect(await client.flush()).toEqual({ type: 'flushed', ok: true })

    await transitionLesson(db, {
      lessonId,
      action: 'approve',
      actor: { id: users.approver.id, role: 'approver' },
    })
    const approvedVersions = await versionsOf(lessonId)
    expect(approvedVersions.map((v) => sayText(v.content))).toEqual([`Approved text. ${SAY_TEXT}`])

    blockText(client.doc, 'say', 'b-say').insert(0, 'Too late. ')
    expect(await client.flush()).toMatchObject({ type: 'flushed', ok: false, reason: 'locked' })
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS + 500))
    expect(sayText((await lessonRow(lessonId)).content)).toBe(`Approved text. ${SAY_TEXT}`)
    expect(await versionsOf(lessonId)).toHaveLength(1)
    const other = await openSynced(lessonId, users.reviewer)
    expect(sayText(snapshot(other.doc))).toBe(`Approved text. ${SAY_TEXT}`)
  })

  it('rejects unauthenticated connections, unknown lessons and non-lesson documents', async () => {
    const lessonId = await createLesson()
    const attempts = [
      open(lessonId, null, null),
      open(lessonId, null, 'v1.not.valid'),
      open(
        lessonId,
        null,
        signCollabToken({ ...users.reviewer, email: 'x@example.com' }, 'other-secret'),
      ),
      open('00000000-0000-4000-8000-000000000000', users.reviewer),
      open('not-a-uuid', users.reviewer),
    ]
    const other = connect(wsUrl, 'scratch-document', tokenFor(users.reviewer))
    clients.push(other)
    const outcomes = await Promise.all([...attempts, other].map((attempt) => attempt.outcome))
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(Array(6).fill('denied'))

    expect((await lessonRow(lessonId)).content).toEqual(richLessonContent())
    expect(await db.select({ name: yjsDocuments.name }).from(yjsDocuments)).toEqual([])
  })
})
