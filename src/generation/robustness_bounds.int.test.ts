// M5 hardening, second follow-up (re-validation findings, R6, R11, R12): crash retries never wait
// on each other's leftover reservations, and a repair call is admitted like a first call (run
// still active, room under the caps), so a cap is overshot by at most one estimate even when
// repairs happen. Contract: src/generation/README.md, section "M5 robustness contract". Fake LLM
// only.
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import {
  createFakeLlm,
  createGate,
  TEST_MODEL,
  TEST_PRICES,
  type FakeLlm,
} from '../../tests/fake_llm'
import { coreLessonBody } from '../../tests/fixtures/lesson/lesson_fixture'
import { createTestUnit } from '../../tests/generation_fixtures'
import { runMigrations } from '../db/migrate'
import { generationJobs, generationRuns, lessons } from '../db/schema'
import type { LessonBody } from '../lesson/schema'
import { applySystemTransition, getLessonHistory } from '../workflow/service'
import { computeCostUsd, ESTIMATED_TOKENS_PER_LESSON } from './llm'
import { ensureGenerationQueue, GENERATE_LESSON_QUEUE, type GenerateLessonJobData } from './queue'
import { cancelRun, getRun, startRun, type GenerationDeps, type RunView } from './service'
import { registerGenerationWorker, type GenerationWorker } from './worker'

const POLL = { timeout: 20_000, interval: 100 }
const HEARTBEAT_SECONDS = 10
/** A dead worker's job comes back after the heartbeat window, the sweep and the retry delay. */
const CRASH_POLL = { timeout: 75_000, interval: 250 }
const LESSON_ESTIMATE_USD = computeCostUsd(TEST_MODEL, ESTIMATED_TOKENS_PER_LESSON, TEST_PRICES)

/** A lesson that fails validation (55 minutes in total). */
function invalidBody(): LessonBody {
  const body = coreLessonBody()
  body.sections[0]!.minutes = 10
  return body
}

function unfinished(run: RunView) {
  return run.jobs.filter((job) => job.status === 'queued' || job.status === 'generating')
}

describe('crash retries and repair calls under caps (M5 follow-up: R6, R11, R12)', () => {
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

  async function startWorker(
    llm: FakeLlm,
    options: { concurrency?: number; maxAttempts?: number; on?: PgBoss } = {},
  ) {
    const worker = await registerGenerationWorker({
      db,
      boss: options.on ?? boss,
      llm,
      prices: TEST_PRICES,
      concurrency: options.concurrency ?? 2,
      maxAttempts: options.maxAttempts ?? 2,
      pollingIntervalSeconds: 0.5,
      heartbeatSeconds: HEARTBEAT_SECONDS,
      globalCapUsd: 1_000_000,
    })
    workers.push(worker)
    return worker
  }

  /** As in robustness_settle.int.test.ts: claim `count` jobs, write what admission writes, die. */
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

  async function reservedUsd(runId: string): Promise<number[]> {
    const rows = await db
      .select({ reservedUsd: generationJobs.reservedUsd })
      .from(generationJobs)
      .where(eq(generationJobs.runId, runId))
    return rows.map((row) => row.reservedUsd)
  }

  async function generatingLessons(lessonIds: string[]) {
    const rows = await db
      .select({ status: lessons.status })
      .from(lessons)
      .where(inArray(lessons.id, lessonIds))
    return rows.filter((row) => row.status === 'generating').length
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

  it('crash retries never wait on each other: spent < cap <= spent + the other retries’ reservations', async () => {
    const unit = await createTestUnit(db, { lessons: 3 })
    const capUsd = 1.5 * LESSON_ESTIMATE_USD
    const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd })
    const jobIds = await claimAndDie(2)
    // The third lesson spent one estimate (its job failed) before the worker died.
    await db
      .update(generationRuns)
      .set({ costUsd: LESSON_ESTIMATE_USD })
      .where(eq(generationRuns.id, runId))
    await db
      .update(generationJobs)
      .set({ status: 'failed', error: 'invalid', costUsd: LESSON_ESTIMATE_USD })
      .where(and(eq(generationJobs.runId, runId), notInArray(generationJobs.id, jobIds)))

    const llm = createFakeLlm({ usage: ESTIMATED_TOKENS_PER_LESSON, delayMs: 200 })
    await startWorker(llm, { concurrency: 2 })

    // Each retry counted the other's leftover reservation (e + e >= 1.5e) and waited forever.
    await expect
      .poll(async () => (await getRun(db, runId))?.status, CRASH_POLL)
      .toBeOneOf(['stopped_cap', 'completed'])
    const run = (await getRun(db, runId))!
    expect(unfinished(run)).toEqual([])
    expect(await reservedUsd(runId)).toEqual([0, 0, 0])
    expect(await generatingLessons(unit.lessonIds)).toBe(0)
    // One retry fits (e + e), the other then finds the cap reached.
    expect(llm.calls).toHaveLength(1)
    expect(run.costUsd).toBeLessThanOrEqual(capUsd + LESSON_ESTIMATE_USD + 1e-9)
  }, 150_000)

  it('repairs stay within one estimate of the cap: always-invalid answers, 2 processes x concurrency 4', async () => {
    const unit = await createTestUnit(db, { lessons: 10 })
    const capUsd = 2.5 * LESSON_ESTIMATE_USD
    const llm = createFakeLlm({
      usage: ESTIMATED_TOKENS_PER_LESSON,
      delayMs: 300,
      respond: () => invalidBody(),
    })
    const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd })
    const bossA = newBoss()
    const bossB = newBoss()
    extraBosses.push(bossA, bossB)
    await Promise.all([bossA.start(), bossB.start()])
    await startWorker(llm, { concurrency: 4, maxAttempts: 2, on: bossA })
    await startWorker(llm, { concurrency: 4, maxAttempts: 2, on: bossB })

    await expect.poll(async () => (await getRun(db, runId))?.status, POLL).toBe('stopped_cap')
    await expect.poll(async () => unfinished((await getRun(db, runId))!).length, POLL).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const run = (await getRun(db, runId))!

    // Before: each admitted job made its repair call too (cap + 3.5 estimates).
    expect(run.costUsd).toBeLessThanOrEqual(capUsd + LESSON_ESTIMATE_USD + 1e-9)
    expect(run.costUsd).toBeCloseTo(llm.calls.length * LESSON_ESTIMATE_USD, 10)
    expect((await reservedUsd(runId)).every((usd) => usd === 0)).toBe(true)
    expect(await generatingLessons(unit.lessonIds)).toBe(0)
    // A job stopped before its repair call says why.
    const stopped = run.jobs.filter((job) => job.attempts === 1 && job.status === 'cancelled')
    expect(stopped.length).toBeGreaterThan(0)
    for (const job of stopped) {
      expect(job.error ?? '').toMatch(/cap/i)
    }
  }, 60_000)

  it('a run cancelled during a call makes no repair call', async () => {
    const unit = await createTestUnit(db, { lessons: 1 })
    const lessonId = unit.lessonIds[0]!
    const gate = createGate()
    const llm = createFakeLlm({
      respond: async () => {
        await gate.promise
        return invalidBody()
      },
    })
    const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 5 })
    await startWorker(llm, { concurrency: 1, maxAttempts: 2 })
    await expect.poll(() => llm.calls.length, POLL).toBe(1)

    await cancelRun(deps, runId)
    gate.release()

    await expect
      .poll(async () => (await getRun(db, runId))!.jobs[0]!.status, POLL)
      .toBe('cancelled')
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(llm.calls).toHaveLength(1)
    const run = (await getRun(db, runId))!
    expect(run.status).toBe('cancelled')
    expect(run.jobs[0]).toEqual(expect.objectContaining({ attempts: 1 }))
    expect(await reservedUsd(runId)).toEqual([0])
    expect(run.jobs[0]!.error ?? '').toMatch(/cancel/i)
    const [row] = await db.select().from(lessons).where(eq(lessons.id, lessonId))
    expect(row!.status).toBe('failed')
    const last = (await getLessonHistory(db, lessonId)).at(-1)
    expect(last).toEqual(
      expect.objectContaining({ fromStatus: 'generating', toStatus: 'failed', actor: null }),
    )
    expect(last!.note ?? '').toMatch(/cancel/i)
  })
})
