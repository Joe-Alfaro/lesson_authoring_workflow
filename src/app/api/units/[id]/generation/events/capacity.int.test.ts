// B1 (M4 validation): 25 open dashboard feeds (more than DB_POOL_MAX) share one LISTEN connection,
// every feed still gets live events, and database-backed routes (sign-in reads users) keep working.
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { createTestUnit } from '../../../../../../../tests/generation_fixtures'

const { requireApiRole } = vi.hoisted(() => ({ requireApiRole: vi.fn() }))
vi.mock('../../../../../../auth/require_role', () => ({ requireApiRole }))

const SUBSCRIBERS = 25

/** Collects the `type` of every `data:` message an SSE body sends. */
function messageTypes(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const types: string[] = []
  let buffer = ''
  async function pump(): Promise<void> {
    const { value, done } = await reader
      .read()
      .catch(() => ({ value: undefined, done: true as const }))
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    parts.forEach((part) => {
      const data = part
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
      if (data) types.push((JSON.parse(data) as { type: string }).type)
    })
    return pump()
  }
  const done = pump()
  return {
    types,
    async close() {
      await reader.cancel().catch(() => {})
      await done
    },
  }
}

describe('dashboard feed capacity (B1)', () => {
  let route: typeof import('./route')
  let client: typeof import('../../../../../../db/client')
  const previousMax = process.env.DB_POOL_MAX

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    process.env.DB_POOL_MAX = '4'
    client = await import('../../../../../../db/client')
    const { runMigrations } = await import('../../../../../../db/migrate')
    await runMigrations(client.getPool())
    route = await import('./route')
    requireApiRole.mockResolvedValue({
      id: 'u',
      role: 'reviewer',
      email: 'r@example.com',
      name: 'R',
    })
  })
  afterAll(async () => {
    if (previousMax === undefined) delete process.env.DB_POOL_MAX
    else process.env.DB_POOL_MAX = previousMax
    await client.getPool().end()
  })

  it(`serves ${SUBSCRIBERS} open feeds on one LISTEN and keeps database routes working`, async () => {
    const db = client.getDb()
    expect(client.getPool().options.max).toBe(4)
    const unit = await createTestUnit(db, { lessons: 1 })
    const controllers = Array.from({ length: SUBSCRIBERS }, () => new AbortController())
    const responses = await Promise.all(
      controllers.map((controller) =>
        route.GET(
          new Request(`http://localhost/api/units/${unit.unitId}/generation/events`, {
            signal: controller.signal,
          }),
          { params: Promise.resolve({ id: unit.unitId }) },
        ),
      ),
    )
    const feeds = responses.map((response) => {
      expect(response.status).toBe(200)
      return messageTypes(response.body!)
    })
    try {
      await expect
        .poll(() => feeds.every((feed) => feed.types.includes('snapshot')), { timeout: 10_000 })
        .toBe(true)

      // What sign-in does: read the users table. It must not wait for a pool client.
      const started = Date.now()
      await db.execute(sql`SELECT count(*) FROM users`)
      expect(Date.now() - started).toBeLessThan(2_000)

      const listening = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE query ILIKE 'LISTEN generation_progress%'`,
      )
      expect(listening.rows[0]!.n).toBe(1)

      const { notifyLessonProgress } = await import('../../../../../../generation/progress')
      await notifyLessonProgress(db, {
        unitId: unit.unitId,
        lessonId: unit.lessonIds[0]!,
        lessonNumber: 1,
        status: 'queued',
      })
      await expect
        .poll(() => feeds.every((feed) => feed.types.includes('lesson')), { timeout: 10_000 })
        .toBe(true)
    } finally {
      controllers.forEach((controller) => controller.abort())
      await Promise.all(feeds.map((feed) => feed.close()))
    }
  })
})
