// M5 hardening follow-up (validation defect, R6, R12): a crash retry that reaches a run no longer
// active, or a cap reached while its worker was dead, releases the job's reservation and moves a
// lesson left Generating back. A stale reservation on a finished row never blocks admission.
// Contract: src/generation/README.md, section "M5 robustness contract". Fake LLM only.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { createFakeLlm, TEST_MODEL, TEST_PRICES, type FakeLlm } from '../../tests/fake_llm'
import { coreLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'
import { createTestUnit } from '../../tests/generation_fixtures'
import { runMigrations } from '../db/migrate'
import { generationJobs, lessons } from '../db/schema'
import { applySystemTransition, getLessonHistory } from '../workflow/service'
import { computeCostUsd, ESTIMATED_TOKENS_PER_LESSON } from './llm'
import { ensureGenerationQueue, GENERATE_LESSON_QUEUE, type GenerateLessonJobData } from './queue'
import { cancelRun, getRun, getTotalSpendUsd, startRun, type GenerationDeps } from './service'
import { registerGenerationWorker, type GenerationWorker } from './worker'

const POLL = { timeout: 20_000, interval: 100 }
const HEARTBEAT_SECONDS = 10
/** A dead worker's job comes back after the heartbeat window, the sweep and the retry delay. */
const CRASH_POLL = { timeout: 75_000, interval: 250 }
const LESSON_ESTIMATE_USD = computeCostUsd(TEST_MODEL, ESTIMATED_TOKENS_PER_LESSON, TEST_PRICES)

describe('settling crash retries that may not run (M5 follow-up: R6, R12)', () => {
  const { pool, db } = connectTestDb()
  let boss: PgBoss
  let deps: GenerationDeps
  const workers: GenerationWorker[] = []
  const extraBosses: PgBoss[] = []

  function newBoss(options: { superviseIntervalSeconds?: number } = {}) {
    const created = new PgBoss({ connectionString: inject('databaseUrl'), ...options })
    created.on('error', (error) => console.error('[test] pg-boss error', error))
    return created
  }

  async function startWorker(llm: FakeLlm, globalCapUsd: number) {
    const worker = await registerGenerationWorker({
      db,
      boss,
      llm,
      prices: TEST_PRICES,
      concurrency: 2,
      maxAttempts: 2,
      pollingIntervalSeconds: 0.5,
      heartbeatSeconds: HEARTBEAT_SECONDS,
      globalCapUsd,
    })
    workers.push(worker)
    return worker
  }

  /**
   * A worker process claims `count` queued jobs and does what admission and processJob do before
   * the model call (row Generating with one estimate reserved, attempt 1, lesson Generating), then
   * dies mid-call (SIGKILL: no heartbeat, no completion, no `finally`).
   */
  async function claimAndDie(count: number): Promise<string[]> {
    const dead = newBoss()
    extraBosses.push(dead)
    await dead.start()
    const claimed: { data: GenerateLessonJobData }[] = []
    await expect
      .poll(
        async () => {
          const fetched = await dead.fetch<GenerateLessonJobData>(GENERATE_LESSON_QUEUE, {
            batchSize: count - claimed.length,
          })
          claimed.push(...fetched)
          return claimed.length
        },
        { timeout: 30_000, interval: 500 },
      )
      .toBe(count)
    const jobIds = claimed.map((job) => job.data.jobId)
    const rows = await db
      .update(generationJobs)
      .set({
        status: 'generating',
        attempts: 1,
        reservedUsd: LESSON_ESTIMATE_USD,
        updatedAt: new Date(),
      })
      .where(inArray(generationJobs.id, jobIds))
      .returning({ lessonId: generationJobs.lessonId })
    for (const row of rows) {
      await applySystemTransition(db, { lessonId: row.lessonId, to: 'generating' })
    }
    await dead.stop({ graceful: false })
    return jobIds
  }

  async function jobRows(jobIds: string[]) {
    return db.select().from(generationJobs).where(inArray(generationJobs.id, jobIds))
  }

  async function lessonRow(id: string) {
    const [row] = await db.select().from(lessons).where(eq(lessons.id, id))
    return row!
  }

  async function reservedOutsideGenerating(): Promise<number> {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${generationJobs.reservedUsd}), 0)` })
      .from(generationJobs)
      .where(sql`${generationJobs.status} <> 'generating'`)
    return Number(row?.total ?? 0)
  }

  /** A fresh 2-lesson run under `globalCapUsd`: completes when nothing stale holds the budget. */
  async function laterRunCompletes(llm: FakeLlm) {
    const unit = await createTestUnit(db, { lessons: 2 })
    const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 5 })
    await expect.poll(async () => (await getRun(db, runId))?.status, POLL).toBe('completed')
    const run = (await getRun(db, runId))!
    expect(run.jobs.map((job) => job.status)).toEqual(['generated', 'generated'])
    expect(llm.calls.length).toBeGreaterThanOrEqual(2)
  }

  beforeAll(async () => {
    await runMigrations(pool)
    boss = newBoss({ superviseIntervalSeconds: 1 })
    await boss.start()
    deps = { db, boss, prices: TEST_PRICES, globalCapUsd: 1_000_000 }
  })
  beforeEach(async () => {
    await ensureGenerationQueue(boss, { heartbeatSeconds: HEARTBEAT_SECONDS })
    await boss.deleteAllJobs(GENERATE_LESSON_QUEUE)
  })
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.stop()))
    await Promise.all(extraBosses.splice(0).map((extra) => extra.stop({ graceful: false })))
  })
  afterAll(async () => {
    await boss.stop({ graceful: false })
    await pool.end()
  })

  it('crash then cancel: the retries release their reservations and move both lessons back', async () => {
    const spentBefore = await getTotalSpendUsd(db)
    const unit = await createTestUnit(db, { lessons: 2 })
    const [newLessonId, regenLessonId] = unit.lessonIds as [string, string]
    // The second lesson is a regeneration: it already has content.
    await db
      .update(lessons)
      .set({ content: coreLessonContent() })
      .where(eq(lessons.id, regenLessonId))
    const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 5 })
    const jobIds = await claimAndDie(2)
    await cancelRun(deps, runId)

    // Room for 1.5 estimates: two leaked reservations (2 estimates) would block every later job.
    const llm = createFakeLlm()
    await startWorker(llm, spentBefore + 1.5 * LESSON_ESTIMATE_USD)

    await expect
      .poll(async () => (await jobRows(jobIds)).map((job) => job.status).sort(), CRASH_POLL)
      .toEqual(['cancelled', 'cancelled'])
    const rows = await jobRows(jobIds)
    expect(rows.map((job) => job.reservedUsd)).toEqual([0, 0])
    expect(llm.calls).toHaveLength(0)
    expect((await getRun(db, runId))!.status).toBe('cancelled')

    const failed = await lessonRow(newLessonId)
    expect(failed.status).toBe('failed')
    expect(failed.content).toBeNull()
    const kept = await lessonRow(regenLessonId)
    expect(kept.status).toBe('draft')
    expect(kept.content).not.toBeNull()
    for (const lessonId of [newLessonId, regenLessonId]) {
      const last = (await getLessonHistory(db, lessonId)).at(-1)
      expect(last).toEqual(
        expect.objectContaining({
          fromStatus: 'generating',
          actor: null,
          note: expect.any(String),
        }),
      )
      expect(last!.note!).toMatch(/cancel/i)
    }

    await laterRunCompletes(llm)
  }, 150_000)

  it('crash then cap: a retry that finds the cap reached releases its reservation and moves the lesson back', async () => {
    const unit = await createTestUnit(db, { lessons: 1 })
    const lessonId = unit.lessonIds[0]!
    const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 5 })
    const jobIds = await claimAndDie(1)

    // While the worker was dead, other spend used up the global budget.
    const capped = createFakeLlm()
    const cappedWorker = await startWorker(capped, await getTotalSpendUsd(db))
    await expect.poll(async () => (await jobRows(jobIds))[0]!.status, CRASH_POLL).toBe('cancelled')
    expect((await jobRows(jobIds))[0]!.reservedUsd).toBe(0)
    expect(capped.calls).toHaveLength(0)
    expect((await getRun(db, runId))!.status).toBe('stopped_cap')
    const row = await lessonRow(lessonId)
    expect(row.status).toBe('failed')
    const last = (await getLessonHistory(db, lessonId)).at(-1)
    expect(last).toEqual(
      expect.objectContaining({ fromStatus: 'generating', toStatus: 'failed', actor: null }),
    )
    expect(last!.note!).toMatch(/cap/i)
    await cappedWorker.stop()

    const llm = createFakeLlm()
    await startWorker(llm, (await getTotalSpendUsd(db)) + 1.5 * LESSON_ESTIMATE_USD)
    await laterRunCompletes(llm)
  }, 150_000)

  it('ignores a stale reservation on a row that is not generating', async () => {
    const stale = await createTestUnit(db, { lessons: 1 })
    const { runId: staleRunId } = await startRun(deps, {
      unitId: stale.unitId,
      model: TEST_MODEL,
      capUsd: 5,
    })
    await boss.deleteAllJobs(GENERATE_LESSON_QUEUE)
    // A finished row left holding far more than the budget (as the defect left them).
    await db
      .update(generationJobs)
      .set({ status: 'cancelled', reservedUsd: 100 })
      .where(eq(generationJobs.runId, staleRunId))
    try {
      expect(await reservedOutsideGenerating()).toBeGreaterThanOrEqual(100)
      const llm = createFakeLlm()
      await startWorker(llm, (await getTotalSpendUsd(db)) + 1.5 * LESSON_ESTIMATE_USD)
      await laterRunCompletes(llm)
    } finally {
      await db
        .update(generationJobs)
        .set({ reservedUsd: 0 })
        .where(and(eq(generationJobs.runId, staleRunId), eq(generationJobs.status, 'cancelled')))
    }
  }, 60_000)
})
