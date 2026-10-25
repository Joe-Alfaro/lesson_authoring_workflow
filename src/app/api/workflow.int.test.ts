// R14, R23, R24, R25 and the R27 role checks at the API level. The real requireRole runs against a
// mocked session, so the role lists of each route are under test. Contract: src/workflow/README.md.
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  lessonContent,
  type FixtureUser,
  type FixtureUsers,
} from '../../../tests/workflow_fixtures'
import type { LessonStatus } from '../../db/schema'

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('../../auth/auth', () => ({ auth }))
// requireRole's redirect() and forbidden() as plain errors (as in src/auth/require_role.test.ts).
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  forbidden: () => {
    throw new Error('forbidden')
  },
}))

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

interface Result {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

/** Runs a handler and maps requireRole's interrupts to the status Next would send. */
async function call(handler: () => Promise<Response>): Promise<Result> {
  try {
    const response = await handler()
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'forbidden') {
      return { status: 403, body: null }
    }
    if (message.startsWith('redirect:')) {
      return { status: 307, body: null }
    }
    throw error
  }
}

function signIn(user: FixtureUser | null) {
  auth.mockResolvedValue(
    user && {
      user: { id: user.id, email: `${user.id}@example.com`, name: user.name, role: user.role },
      expires: '2099-01-01T00:00:00.000Z',
    },
  )
}

function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function params<T>(value: T) {
  return { params: Promise.resolve(value) }
}

describe('workflow API', () => {
  let routes: {
    transitions: typeof import('./lessons/[id]/transitions/route')
    history: typeof import('./lessons/[id]/history/route')
    content: typeof import('./lessons/[id]/content/route')
    versions: typeof import('./lessons/[id]/versions/route')
    version: typeof import('./lessons/[id]/versions/[versionId]/route')
    restore: typeof import('./lessons/[id]/versions/[versionId]/restore/route')
    assign: typeof import('./lessons/assign/route')
    dashboard: typeof import('./units/[id]/dashboard/route')
    reviewers: typeof import('./reviewers/route')
    myLessons: typeof import('./me/lessons/route')
  }
  let db: import('../../db/client').Database
  let schema: typeof import('../../db/schema')
  let people: FixtureUsers

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    const client = await import('../../db/client')
    const { runMigrations } = await import('../../db/migrate')
    await runMigrations(client.getPool())
    db = client.getDb()
    schema = await import('../../db/schema')
    routes = {
      transitions: await import('./lessons/[id]/transitions/route'),
      history: await import('./lessons/[id]/history/route'),
      content: await import('./lessons/[id]/content/route'),
      versions: await import('./lessons/[id]/versions/route'),
      version: await import('./lessons/[id]/versions/[versionId]/route'),
      restore: await import('./lessons/[id]/versions/[versionId]/restore/route'),
      assign: await import('./lessons/assign/route'),
      dashboard: await import('./units/[id]/dashboard/route'),
      reviewers: await import('./reviewers/route'),
      myLessons: await import('./me/lessons/route'),
    }
  })
  beforeEach(async () => {
    auth.mockReset()
    await cleanWorkflowData(db)
    people = await createUsers(db)
  })
  afterAll(async () => {
    await cleanWorkflowData(db)
    const { getPool } = await import('../../db/client')
    await getPool().end()
  })

  async function lessonIn(status: LessonStatus, content: unknown = lessonContent('Lesson')) {
    const unit = await createTestUnit(db, { lessons: [{ lessonNumber: 1, status, content }] })
    return unit.lessonIds[0]!
  }

  async function statusOf(lessonId: string) {
    const [row] = await db
      .select({ status: schema.lessons.status })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId))
    return row?.status
  }

  function transition(lessonId: string, body: unknown) {
    return call(() =>
      routes.transitions.POST(
        request(`/api/lessons/${lessonId}/transitions`, 'POST', body),
        params({ id: lessonId }),
      ),
    )
  }

  describe('POST /api/lessons/:id/transitions', () => {
    it('submits, requests changes, resubmits and approves', async () => {
      const lessonId = await lessonIn('draft')
      signIn(people.reviewer)
      expect(await transition(lessonId, { action: 'submit' })).toEqual({
        status: 200,
        body: { status: 'in_review' },
      })
      signIn(people.approver)
      expect(
        (await transition(lessonId, { action: 'request_changes', note: 'Shorten the launch.' }))
          .status,
      ).toBe(200)
      signIn(people.reviewer)
      expect((await transition(lessonId, { action: 'resubmit' })).status).toBe(200)
      signIn(people.approver)
      expect(await transition(lessonId, { action: 'approve' })).toEqual({
        status: 200,
        body: { status: 'approved' },
      })
    })

    it('answers 403 when a reviewer approves or requests changes (R27)', async () => {
      const lessonId = await lessonIn('in_review')
      signIn(people.reviewer)
      expect((await transition(lessonId, { action: 'approve' })).status).toBe(403)
      expect((await transition(lessonId, { action: 'request_changes', note: 'x' })).status).toBe(
        403,
      )
      expect(await statusOf(lessonId)).toBe('in_review')
    })

    it('answers 403 when an author submits or approves', async () => {
      signIn(people.author)
      expect((await transition(await lessonIn('draft'), { action: 'submit' })).status).toBe(403)
      expect((await transition(await lessonIn('in_review'), { action: 'approve' })).status).toBe(
        403,
      )
    })

    it('answers 400 with an error when requesting changes without a note', async () => {
      const lessonId = await lessonIn('in_review')
      signIn(people.approver)
      const result = await transition(lessonId, { action: 'request_changes', note: '  ' })
      expect(result).toEqual({ status: 400, body: { error: expect.any(String) } })
      expect(await statusOf(lessonId)).toBe('in_review')
    })

    it('answers 400 for an unknown action or a malformed body', async () => {
      const lessonId = await lessonIn('draft')
      signIn(people.admin)
      expect((await transition(lessonId, { action: 'publish' })).status).toBe(400)
      expect((await transition(lessonId, {})).status).toBe(400)
      const malformed = await call(() =>
        routes.transitions.POST(
          new Request(`http://localhost/api/lessons/${lessonId}/transitions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{not json',
          }),
          params({ id: lessonId }),
        ),
      )
      expect(malformed.status).toBe(400)
    })

    it('answers 409 for a transition the status does not allow and 404 for an unknown lesson', async () => {
      signIn(people.approver)
      const draft = await lessonIn('draft')
      expect(await transition(draft, { action: 'approve' })).toEqual({
        status: 409,
        body: { error: expect.any(String) },
      })
      expect((await transition(MISSING_ID, { action: 'approve' })).status).toBe(404)
      expect((await transition('nope', { action: 'approve' })).status).toBe(404)
    })

    it('does not run for a signed-out caller', async () => {
      const lessonId = await lessonIn('in_review')
      signIn(null)
      expect([401, 307]).toContain((await transition(lessonId, { action: 'approve' })).status)
      expect(await statusOf(lessonId)).toBe('in_review')
    })
  })

  describe('GET /api/lessons/:id/history', () => {
    it('returns the transitions with who, when and the note for any role', async () => {
      const lessonId = await lessonIn('in_review')
      signIn(people.approver)
      await transition(lessonId, { action: 'request_changes', note: 'Add a teacher tip.' })

      signIn(people.author)
      const result = await call(() =>
        routes.history.GET(request(`/api/lessons/${lessonId}/history`), params({ id: lessonId })),
      )
      expect(result).toEqual({
        status: 200,
        body: {
          events: [
            {
              id: expect.any(String),
              fromStatus: 'in_review',
              toStatus: 'changes_requested',
              actor: { id: people.approver.id, name: people.approver.name, role: 'approver' },
              note: 'Add a teacher tip.',
              at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            },
          ],
        },
      })
    })

    it('answers 404 for an unknown lesson', async () => {
      signIn(people.reviewer)
      const result = await call(() =>
        routes.history.GET(
          request(`/api/lessons/${MISSING_ID}/history`),
          params({ id: MISSING_ID }),
        ),
      )
      expect(result.status).toBe(404)
    })
  })

  describe('lesson content and versions (R14)', () => {
    function save(lessonId: string, content: unknown) {
      return call(() =>
        routes.content.PUT(
          request(`/api/lessons/${lessonId}/content`, 'PUT', { content }),
          params({ id: lessonId }),
        ),
      )
    }

    it('saves content as a version, lists, views and restores it', async () => {
      const lessonId = await lessonIn('in_review')
      signIn(people.reviewer)
      const first = await save(lessonId, lessonContent('Good'))
      expect(first).toEqual({ status: 200, body: { versionId: expect.any(String) } })
      signIn(people.reviewer2)
      await save(lessonId, lessonContent('Worse'))

      signIn(people.author)
      const list = await call(() =>
        routes.versions.GET(request(`/api/lessons/${lessonId}/versions`), params({ id: lessonId })),
      )
      expect(list.status).toBe(200)
      expect(list.body.versions.map((v: { author: { id: string } }) => v.author.id)).toEqual([
        people.reviewer2.id,
        people.reviewer.id,
      ])

      const versionId = first.body.versionId as string
      const view = await call(() =>
        routes.version.GET(
          request(`/api/lessons/${lessonId}/versions/${versionId}`),
          params({ id: lessonId, versionId }),
        ),
      )
      expect(view).toEqual({
        status: 200,
        body: {
          id: versionId,
          lessonId,
          content: lessonContent('Good'),
          createdAt: expect.any(String),
          author: { id: people.reviewer.id, name: people.reviewer.name },
        },
      })

      signIn(people.approver)
      const restored = await call(() =>
        routes.restore.POST(
          request(`/api/lessons/${lessonId}/versions/${versionId}/restore`, 'POST'),
          params({ id: lessonId, versionId }),
        ),
      )
      expect(restored).toEqual({ status: 201, body: { versionId: expect.any(String) } })
      const [lesson] = await db.select().from(schema.lessons).where(eq(schema.lessons.id, lessonId))
      expect(lesson!.content).toEqual(lessonContent('Good'))
      expect(lesson!.lastEditedBy).toBe(people.approver.id)
      const versions = await db
        .select()
        .from(schema.lessonVersions)
        .where(eq(schema.lessonVersions.lessonId, lessonId))
        .orderBy(asc(schema.lessonVersions.createdAt))
      expect(versions.at(-1)).toMatchObject({
        id: restored.body.versionId,
        authorId: people.approver.id,
      })
    })

    it('answers 409 when saving or restoring an approved lesson', async () => {
      const lessonId = await lessonIn('draft')
      signIn(people.reviewer)
      const saved = await save(lessonId, lessonContent('Saved'))
      await db
        .update(schema.lessons)
        .set({ status: 'approved' })
        .where(eq(schema.lessons.id, lessonId))

      expect(await save(lessonId, lessonContent('Blocked'))).toEqual({
        status: 409,
        body: { error: expect.any(String) },
      })
      const versionId = saved.body.versionId as string
      const restore = await call(() =>
        routes.restore.POST(
          request(`/api/lessons/${lessonId}/versions/${versionId}/restore`, 'POST'),
          params({ id: lessonId, versionId }),
        ),
      )
      expect(restore.status).toBe(409)
    })

    it('answers 400 for a body without content and 404 for unknown lessons or versions', async () => {
      const lessonId = await lessonIn('draft')
      signIn(people.reviewer)
      const noContent = await call(() =>
        routes.content.PUT(
          request(`/api/lessons/${lessonId}/content`, 'PUT', {}),
          params({ id: lessonId }),
        ),
      )
      expect(noContent.status).toBe(400)
      expect((await save(MISSING_ID, lessonContent('x'))).status).toBe(404)
      const missingVersion = await call(() =>
        routes.version.GET(
          request(`/api/lessons/${lessonId}/versions/${MISSING_ID}`),
          params({ id: lessonId, versionId: MISSING_ID }),
        ),
      )
      expect(missingVersion.status).toBe(404)
      const missingRestore = await call(() =>
        routes.restore.POST(
          request(`/api/lessons/${lessonId}/versions/${MISSING_ID}/restore`, 'POST'),
          params({ id: lessonId, versionId: MISSING_ID }),
        ),
      )
      expect(missingRestore.status).toBe(404)
    })
  })

  describe('GET /api/units/:id/dashboard', () => {
    it('returns lessons, counts and completion, filtered by query parameters', async () => {
      const unit = await createTestUnit(db, {
        arcs: ['Investigation 1', 'Investigation 2'],
        lessons: [
          {
            lessonNumber: 1,
            status: 'approved',
            content: lessonContent('One'),
            assigneeId: people.reviewer.id,
          },
          { lessonNumber: 2, status: 'in_review', content: lessonContent('Two') },
          { lessonNumber: 3, arc: 1, status: 'draft', assigneeId: people.reviewer.id },
        ],
      })
      signIn(people.reviewer)
      const get = (query = '') =>
        call(() =>
          routes.dashboard.GET(
            request(`/api/units/${unit.unitId}/dashboard${query}`),
            params({ id: unit.unitId }),
          ),
        )

      const all = await get()
      expect(all.status).toBe(200)
      expect(all.body).toMatchObject({
        unit: { id: unit.unitId },
        total: 3,
        complete: false,
        counts: { approved: 1, in_review: 1, draft: 1, changes_requested: 0 },
      })
      expect(all.body.lessons).toHaveLength(3)
      expect(all.body.lessons[0]).toMatchObject({
        lessonNumber: 1,
        status: 'approved',
        assignee: { id: people.reviewer.id, name: people.reviewer.name },
        updatedAt: expect.any(String),
      })

      const numbers = async (query: string) =>
        (await get(query)).body.lessons.map((l: { lessonNumber: number }) => l.lessonNumber)
      expect(await numbers('?status=in_review')).toEqual([2])
      expect(await numbers('?status=in_review&status=draft')).toEqual([2, 3])
      expect(await numbers(`?arc=${unit.arcIds[1]}`)).toEqual([3])
      expect(await numbers(`?assignee=${people.reviewer.id}`)).toEqual([1, 3])
      expect(await numbers('?assignee=unassigned')).toEqual([2])
    })

    it('answers 400 for an unknown status filter and 404 for an unknown unit', async () => {
      const unit = await createTestUnit(db, { lessons: [{ lessonNumber: 1 }] })
      signIn(people.author)
      const badStatus = await call(() =>
        routes.dashboard.GET(
          request(`/api/units/${unit.unitId}/dashboard?status=published`),
          params({ id: unit.unitId }),
        ),
      )
      expect(badStatus.status).toBe(400)
      const missing = await call(() =>
        routes.dashboard.GET(
          request(`/api/units/${MISSING_ID}/dashboard`),
          params({ id: MISSING_ID }),
        ),
      )
      expect(missing.status).toBe(404)
    })
  })

  describe('assignment (R25)', () => {
    function assign(body: unknown) {
      return call(() => routes.assign.POST(request('/api/lessons/assign', 'POST', body)))
    }

    it.each(['author', 'approver', 'admin'] as const)(
      'lets a %s assign lessons in bulk',
      async (role) => {
        const unit = await createTestUnit(db, {
          lessons: [{ lessonNumber: 1 }, { lessonNumber: 2 }],
        })
        signIn(people[role])
        expect(await assign({ lessonIds: unit.lessonIds, assigneeId: people.reviewer.id })).toEqual(
          { status: 200, body: { updated: 2 } },
        )
      },
    )

    it('answers 403 when a reviewer assigns', async () => {
      const unit = await createTestUnit(db, { lessons: [{ lessonNumber: 1 }] })
      signIn(people.reviewer)
      expect(
        (await assign({ lessonIds: unit.lessonIds, assigneeId: people.reviewer.id })).status,
      ).toBe(403)
      const [lesson] = await db.select().from(schema.lessons)
      expect(lesson!.assigneeId).toBeNull()
    })

    it('answers 400 for an invalid assignee or body and 404 for an unknown lesson', async () => {
      const unit = await createTestUnit(db, { lessons: [{ lessonNumber: 1 }] })
      signIn(people.approver)
      expect(
        (await assign({ lessonIds: unit.lessonIds, assigneeId: people.author.id })).status,
      ).toBe(400)
      expect((await assign({ assigneeId: people.reviewer.id })).status).toBe(400)
      expect(
        (await assign({ lessonIds: [MISSING_ID], assigneeId: people.reviewer.id })).status,
      ).toBe(404)
    })

    it('lists assignable reviewers for authors and approvers only', async () => {
      signIn(people.author)
      const result = await call(() => routes.reviewers.GET(request('/api/reviewers')))
      expect(result.status).toBe(200)
      expect(result.body.reviewers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: people.reviewer.id, openAssignments: 0 }),
        ]),
      )
      signIn(people.reviewer)
      expect((await call(() => routes.reviewers.GET(request('/api/reviewers')))).status).toBe(403)
    })

    it("returns the signed-in reviewer's lessons as My lessons", async () => {
      const unit = await createTestUnit(db, {
        lessons: [
          { lessonNumber: 1, assigneeId: people.reviewer.id },
          { lessonNumber: 2, assigneeId: people.reviewer2.id },
        ],
      })
      signIn(people.reviewer)
      const result = await call(() => routes.myLessons.GET(request('/api/me/lessons')))
      expect(result.status).toBe(200)
      expect(result.body.units).toHaveLength(1)
      expect(result.body.units[0].unit.id).toBe(unit.unitId)
      expect(result.body.units[0].lessons.map((l: { id: string }) => l.id)).toEqual([
        unit.lessonIds[0],
      ])
    })
  })
})
