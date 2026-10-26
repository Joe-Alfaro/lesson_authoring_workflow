// R9 at the API level: GET /api/units/:id/generation/events is a Server-Sent Events feed of
// lesson status changes. Contract: src/generation/README.md.
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { TEST_MODEL, TEST_PRICES } from '../../../../../../../tests/fake_llm'
import { createTestUnit } from '../../../../../../../tests/generation_fixtures'

const { requireApiRole } = vi.hoisted(() => ({ requireApiRole: vi.fn() }))
vi.mock('../../../../../../auth/require_role', () => ({ requireApiRole }))

interface FeedMessage {
  type: string
  [key: string]: unknown
}

/** Reads `data: <json>` messages from an SSE body as they arrive. */
function sseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const messages: FeedMessage[] = []
  let buffer = ''
  async function pump(): Promise<void> {
    const { value, done } = await reader
      .read()
      .catch(() => ({ value: undefined, done: true as const }))
    if (done) {
      return
    }
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    parts.forEach((part) => {
      const data = part
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n')
      if (data) {
        messages.push(JSON.parse(data) as FeedMessage)
      }
    })
    return pump()
  }
  const done = pump()
  return {
    messages,
    async close() {
      await reader.cancel().catch(() => {})
      await done
    },
  }
}

describe('GET /api/units/:id/generation/events (R9)', () => {
  let route: typeof import('./route')
  let db: import('../../../../../../db/client').Database
  let boss: PgBoss
  const cleanups: Array<() => Promise<void>> = []

  function get(unitId: string, signal?: AbortSignal) {
    return route.GET(
      new Request(`http://localhost/api/units/${unitId}/generation/events`, { signal }),
      {
        params: Promise.resolve({ id: unitId }),
      },
    )
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    const client = await import('../../../../../../db/client')
    const { runMigrations } = await import('../../../../../../db/migrate')
    await runMigrations(client.getPool())
    db = client.getDb()
    boss = new PgBoss({ connectionString: inject('databaseUrl') })
    boss.on('error', (error) => console.error('[test] pg-boss error', error))
    await boss.start()
    // Its own queue, so the file doesn't depend on another one having created it.
    const { ensureGenerationQueue } = await import('../../../../../../generation/queue')
    await ensureGenerationQueue(boss)
    route = await import('./route')
    requireApiRole.mockResolvedValue({
      id: 'user-1',
      role: 'reviewer',
      email: 'r@example.com',
      name: 'R',
    })
  })
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })
  afterAll(async () => {
    await boss.stop({ graceful: false })
  })

  it('requires a signed-in user with any lesson role', async () => {
    const unit = await createTestUnit(db, { lessons: 1 })
    const controller = new AbortController()
    const response = await get(unit.unitId, controller.signal)
    cleanups.push(async () => {
      controller.abort()
      await response.body?.cancel().catch(() => {})
    })

    expect(requireApiRole).toHaveBeenCalledWith(
      expect.arrayContaining(['author', 'reviewer', 'approver']),
    )
  })

  it('answers 404 for an unknown unit', async () => {
    const response = await get('00000000-0000-0000-0000-000000000000')
    expect(response.status).toBe(404)
  })

  it('streams a snapshot, then lesson status changes within 5 seconds', async () => {
    const unit = await createTestUnit(db, { lessons: 2 })
    const controller = new AbortController()
    const response = await get(unit.unitId, controller.signal)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/)
    const feed = sseReader(response.body!)
    cleanups.push(async () => {
      controller.abort()
      await feed.close()
    })

    await expect
      .poll(() => feed.messages[0]?.type, { timeout: 5_000, interval: 50 })
      .toBe('snapshot')
    expect(feed.messages[0]).toEqual(
      expect.objectContaining({
        progress: expect.objectContaining({
          lessons: expect.any(Array),
          counts: expect.any(Object),
        }),
      }),
    )

    const { startRun } = await import('../../../../../../generation/service')
    const startedAt = Date.now()
    await startRun(
      { db, boss, prices: TEST_PRICES },
      { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 },
    )

    await expect
      .poll(
        () =>
          feed.messages.filter(
            (message) => message.type === 'lesson' && message.status === 'queued',
          ).length,
        { timeout: 5_000, interval: 50 },
      )
      .toBe(2)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(feed.messages.find((message) => message.type === 'lesson')).toEqual(
      expect.objectContaining({ unitId: unit.unitId, lessonId: expect.any(String) }),
    )
  })
})
