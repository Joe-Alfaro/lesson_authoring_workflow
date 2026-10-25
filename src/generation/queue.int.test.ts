// R6 crash recovery: a job held by a worker that died is retried within the heartbeat window
// (GENERATION_HEARTBEAT_SECONDS, default <= 3 min) instead of pg-boss's 15-minute expiry.
// Contract: src/generation/README.md, section "Queue". No test calls a real model.
import { eq } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { createFakeLlm, TEST_MODEL, TEST_PRICES } from '../../tests/fake_llm'
import { createTestUnit } from '../../tests/generation_fixtures'
import { runMigrations } from '../db/migrate'
import { generationJobs, lessons } from '../db/schema'
import { ensureGenerationQueue, GENERATE_LESSON_QUEUE } from './queue'
import { getRun, startRun } from './service'
import { getGenerationHeartbeatSeconds } from './settings'
import { registerGenerationWorker, type GenerationWorker } from './worker'

describe('generation queue crash recovery (R6)', () => {
  const { pool, db } = connectTestDb()
  let boss: PgBoss
  const workers: GenerationWorker[] = []
  const extraBosses: PgBoss[] = []

  function newBoss(options: { superviseIntervalSeconds?: number } = {}) {
    const created = new PgBoss({ connectionString: inject('databaseUrl'), ...options })
    created.on('error', (error) => console.error('[test] pg-boss error', error))
    return created
  }

  beforeAll(async () => {
    await runMigrations(pool)
    // Supervise every second so a stale heartbeat is noticed quickly in the test.
    boss = newBoss({ superviseIntervalSeconds: 1 })
    await boss.start()
  })
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.stop()))
    await Promise.all(extraBosses.splice(0).map((extra) => extra.stop({ graceful: false })))
    await ensureGenerationQueue(boss)
    await boss.deleteAllJobs(GENERATE_LESSON_QUEUE)
  })
  afterAll(async () => {
    await boss.stop({ graceful: false })
    await pool.end()
  })

  it('creates the queue with a heartbeat window of at most 3 minutes by default', async () => {
    await ensureGenerationQueue(boss)
    const queue = await boss.getQueue(GENERATE_LESSON_QUEUE)
    expect(queue?.heartbeatSeconds).toBe(getGenerationHeartbeatSeconds())
    expect(queue!.heartbeatSeconds!).toBeLessThanOrEqual(180)
    expect(queue!.retryLimit).toBeGreaterThanOrEqual(1)
  })

  it('applies a configured heartbeat to an existing queue', async () => {
    await ensureGenerationQueue(boss)
    await ensureGenerationQueue(boss, { heartbeatSeconds: 30 })
    expect((await boss.getQueue(GENERATE_LESSON_QUEUE))?.heartbeatSeconds).toBe(30)
    await ensureGenerationQueue(boss, { heartbeatSeconds: 45 })
    expect((await boss.getQueue(GENERATE_LESSON_QUEUE))?.heartbeatSeconds).toBe(45)
  })

  it('retries the job of a killed worker within the heartbeat window, without waiting for expiry', async () => {
    await ensureGenerationQueue(boss, { heartbeatSeconds: 10 })
    const unit = await createTestUnit(db, { lessons: 1 })
    const lessonId = unit.lessonIds[0]!
    const { runId } = await startRun(
      { db, boss, prices: TEST_PRICES },
      { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 },
    )

    // A worker claims the job, starts generating and dies: no heartbeat, no completion.
    const dead = newBoss()
    extraBosses.push(dead)
    await dead.start()
    const claimed = await dead.fetch(GENERATE_LESSON_QUEUE)
    expect(claimed).toHaveLength(1)
    await db
      .update(generationJobs)
      .set({ status: 'generating', updatedAt: new Date() })
      .where(eq(generationJobs.runId, runId))
    await dead.stop({ graceful: false })
    const startedAt = Date.now()

    const llm = createFakeLlm()
    workers.push(
      await registerGenerationWorker({
        db,
        boss,
        llm,
        prices: TEST_PRICES,
        concurrency: 1,
        heartbeatSeconds: 10,
        pollingIntervalSeconds: 0.5,
      }),
    )

    await expect
      .poll(async () => (await getRun(db, runId))?.status, { timeout: 45_000, interval: 250 })
      .toBe('completed')
    // Heartbeat (10 s) + supervision + pg-boss retry delay, far below the 900 s expiry.
    expect(Date.now() - startedAt).toBeLessThan(40_000)
    const run = (await getRun(db, runId))!
    expect(run.jobs).toEqual([expect.objectContaining({ lessonId, status: 'generated' })])
    expect(llm.calls).toHaveLength(1)
    const [row] = await db.select().from(lessons).where(eq(lessons.id, lessonId))
    expect(row!.content).not.toBeNull()
  }, 60_000)
})
