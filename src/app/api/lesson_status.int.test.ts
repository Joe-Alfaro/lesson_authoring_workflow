// R23 live status without a held connection (M4 validation B1): the editor polls
// GET /api/lessons/:id/status. Tiny JSON, ETag on the status, 304 when unchanged.
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  lessonContent,
  type FixtureUser,
  type FixtureUsers,
} from '../../../tests/workflow_fixtures'

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('../../auth/auth', () => ({ auth }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  forbidden: () => {
    throw new Error('forbidden')
  },
}))

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

function signIn(user: FixtureUser | null) {
  auth.mockResolvedValue(
    user && {
      user: { id: user.id, email: `${user.id}@example.com`, name: user.name, role: user.role },
      expires: '2099-01-01T00:00:00.000Z',
    },
  )
}

describe('GET /api/lessons/:id/status', () => {
  let route: typeof import('./lessons/[id]/status/route')
  let db: import('../../db/client').Database
  let people: FixtureUsers

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    const client = await import('../../db/client')
    const { runMigrations } = await import('../../db/migrate')
    await runMigrations(client.getPool())
    db = client.getDb()
    route = await import('./lessons/[id]/status/route')
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

  function get(lessonId: string, etag?: string) {
    return route.GET(
      new Request(`http://localhost/api/lessons/${lessonId}/status`, {
        headers: etag ? { 'if-none-match': etag } : undefined,
      }),
      { params: Promise.resolve({ id: lessonId }) },
    )
  }

  it('answers the status with an ETag, and 304 while it is unchanged', async () => {
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 1, status: 'in_review', content: lessonContent('L1') }],
    })
    const lessonId = unit.lessonIds[0]!
    signIn(people.author)
    const first = await get(lessonId)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ status: 'in_review' })
    expect(first.headers.get('cache-control')).toMatch(/no-store|no-cache/)
    const etag = first.headers.get('etag')!
    expect(etag).toBeTruthy()

    const again = await get(lessonId, etag)
    expect(again.status).toBe(304)

    const { lessons } = await import('../../db/schema')
    const { eq } = await import('drizzle-orm')
    await db.update(lessons).set({ status: 'approved' }).where(eq(lessons.id, lessonId))
    const changed = await get(lessonId, etag)
    expect(changed.status).toBe(200)
    expect(await changed.json()).toEqual({ status: 'approved' })
  })

  it('answers 404 for an unknown lesson and redirects without a session', async () => {
    signIn(people.reviewer)
    expect((await get(MISSING_ID)).status).toBe(404)
    signIn(null)
    await expect(get(MISSING_ID)).rejects.toThrow(/redirect:/)
  })
})
