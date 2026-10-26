// M5 generation hardening (D-045, R6, R7, R11, R12): crash retries that run out, attempts that
// carry across crashes, caps that account for in-flight jobs, prompt polish the worker enforces,
// and malformed JSON repaired by the retry. Contract: src/generation/README.md, section
// "M5 robustness". No test calls a real model: the LLM is tests/fake_llm.ts, or the real Anthropic
// adapter pointed at the local fake Messages API (tests/e2e/fake_anthropic.ts).
import { eq } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { startFakeAnthropic } from '../../tests/e2e/fake_anthropic'
import {
  createFakeLlm,
  createGate,
  TEST_CALL_COST,
  TEST_MODEL,
  TEST_PRICES,
  type FakeLlm,
} from '../../tests/fake_llm'
import { coreFrontMatter, coreLessonBody } from '../../tests/fixtures/lesson/lesson_fixture'
import { createTestUnit } from '../../tests/generation_fixtures'
import { runMigrations } from '../db/migrate'
import { generationJobs, lessons } from '../db/schema'
import type { LessonBody } from '../lesson/schema'
import { InvalidTransitionError } from '../workflow/errors'
import { applySystemTransition, getLessonHistory } from '../workflow/service'
import { createAnthropicLlmClient } from './anthropic_client'
import { computeCostUsd, ESTIMATED_TOKENS_PER_LESSON, type LlmClient } from './llm'
import { polishHints } from './post_process'
import { getUnitProgress } from './progress'
import { ensureGenerationQueue, GENERATE_LESSON_QUEUE } from './queue'
import {
  getLessonGeneration,
  getRun,
  getTotalSpendUsd,
  startRun,
  type GenerationDeps,
  type RunView,
} from './service'
import { registerGenerationWorker, type GenerationWorker } from './worker'

const POLL = { timeout: 20_000, interval: 100 }
/** Heartbeat window for the crash tests: the pg-boss minimum, so a dead worker is noticed fast. */
const HEARTBEAT_SECONDS = 10
/** A dead worker's job comes back after the heartbeat window, the sweep and the retry delay. */
const CRASH_POLL = { timeout: 75_000, interval: 250 }
/** Port of the fake Anthropic Messages API (this session's range). */
const FAKE_ANTHROPIC_PORT = 3776

/** One lesson's estimated cost at the test prices: the default estimate's tokens ($0.216). */
const LESSON_ESTIMATE_USD = computeCostUsd(TEST_MODEL, ESTIMATED_TOKENS_PER_LESSON, TEST_PRICES)

/** A lesson whose correct pulse check option is the longest one (what both models do). */
function longestCorrectBody(): LessonBody {
  const body = coreLessonBody()
  body.sections
    .flatMap((section) => section.parts.flatMap((part) => part.blocks))
    .forEach((block) => {
      if (block.type === 'pulse_check') {
        const correct = block.options.find((option) => option.correct)!
        correct.text = `${correct.text} It shows the character's nervous feelings on the first day.`
      }
    })
  return body
}

/** A lesson that fails validation (55 minutes in total). */
function invalidBody(): LessonBody {
  const body = coreLessonBody()
  body.sections[0]!.minutes = 10
  return body
}

function unfinished(run: RunView) {
  return run.jobs.filter((job) => job.status === 'queued' || job.status === 'generating')
}

describe('generation hardening (M5: R6, R7, R11, R12)', () => {
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
    llm: LlmClient,
    options: {
      concurrency?: number
      maxAttempts?: number
      globalCapUsd?: number
      on?: PgBoss
    } = {},
  ) {
    const worker = await registerGenerationWorker({
      db,
      boss: options.on ?? boss,
      llm,
      prices: TEST_PRICES,
      concurrency: options.concurrency ?? 1,
      maxAttempts: options.maxAttempts ?? 2,
      pollingIntervalSeconds: 0.5,
      heartbeatSeconds: HEARTBEAT_SECONDS,
      ...(options.globalCapUsd === undefined ? {} : { globalCapUsd: options.globalCapUsd }),
    })
    workers.push(worker)
    return worker
  }

  async function waitForRun(runId: string, statuses: string[], poll = POLL) {
    await expect.poll(async () => (await getRun(db, runId))?.status, poll).toBeOneOf(statuses)
    return (await getRun(db, runId))!
  }

  async function lessonRow(id: string) {
    const [row] = await db.select().from(lessons).where(eq(lessons.id, id))
    return row!
  }

  /**
   * A worker process claims the run's queued job, does what processJob does before and during the
   * model call (job and lesson Generating, `attempts` = the attempt it was on), then dies: no
   * heartbeat, no completion. Returns the pg-boss job id.
   */
  async function claimAndDie(runId: string, lessonId: string, attempts: number): Promise<string> {
    const dead = newBoss()
    extraBosses.push(dead)
    await dead.start()
    let claimed: { id: string }[] = []
    await expect
      .poll(
        async () => {
          claimed = await dead.fetch(GENERATE_LESSON_QUEUE)
          return claimed.length
        },
        { timeout: 30_000, interval: 500 },
      )
      .toBe(1)
    await db
      .update(generationJobs)
      .set({ status: 'generating', attempts, updatedAt: new Date() })
      .where(eq(generationJobs.runId, runId))
    await applySystemTransition(db, { lessonId, to: 'generating' }).catch((error: unknown) => {
      if (!(error instanceof InvalidTransitionError)) {
        throw error
      }
    })
    await dead.stop({ graceful: false })
    return claimed[0]!.id
  }

  beforeAll(async () => {
    await runMigrations(pool)
    // Supervise every second so a stale heartbeat is noticed quickly.
    boss = newBoss({ superviseIntervalSeconds: 1 })
    await boss.start()
    // Runs start under a large global budget; the global-cap test passes its own to the worker.
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

  describe('crash retries (R6, D-045 (1), (2))', () => {
    it('fails the lesson with a workflow event and finishes the run when pg-boss has no retry left for a dead worker', async () => {
      const unit = await createTestUnit(db, { lessons: 1 })
      const lessonId = unit.lessonIds[0]!
      const { runId } = await startRun(deps, {
        unitId: unit.unitId,
        model: TEST_MODEL,
        capUsd: 1,
      })
      const retryLimit = (await boss.getQueue(GENERATE_LESSON_QUEUE))!.retryLimit!
      expect(retryLimit).toBeGreaterThanOrEqual(1)

      // Every try dies mid-job. The earlier deaths are failed the way the lost-heartbeat sweep
      // fails them; the last one is left for the live worker's sweep to find.
      for (let death = 0; death < retryLimit; death += 1) {
        const queueJobId = await claimAndDie(runId, lessonId, 0)
        await boss.fail(GENERATE_LESSON_QUEUE, queueJobId, { message: 'job heartbeat timeout' })
      }
      const lastQueueJobId = await claimAndDie(runId, lessonId, 0)
      const llm = createFakeLlm()
      await startWorker(llm)

      // Today the row stays 'generating' after pg-boss gives up, so the run never completes.
      await expect
        .poll(async () => {
          const current = (await getRun(db, runId))!
          return { run: current.status, job: current.jobs[0]!.status }
        }, CRASH_POLL)
        .toEqual({ run: 'completed', job: 'failed' })
      const run = (await getRun(db, runId))!

      // The premise: pg-boss gave up on the job.
      const queueJob = await boss.getJobById(GENERATE_LESSON_QUEUE, lastQueueJobId)
      expect(queueJob?.state).toBe('failed')
      expect(run.finishedAt).not.toBeNull()
      expect(run.jobs).toEqual([
        expect.objectContaining({ lessonId, status: 'failed', error: expect.any(String) }),
      ])
      expect(run.jobs[0]!.error!.trim()).not.toBe('')
      expect(unfinished(run)).toEqual([])
      expect(llm.calls).toHaveLength(0)
      const row = await lessonRow(lessonId)
      expect(row.status).toBe('failed')
      expect(row.content).toBeNull()
      const history = await getLessonHistory(db, lessonId)
      expect(history.at(-1)).toEqual(
        expect.objectContaining({ fromStatus: 'generating', toStatus: 'failed', actor: null }),
      )
      const progress = await getUnitProgress(db, unit.unitId)
      expect(progress.lessons.find((lesson) => lesson.lessonId === lessonId)?.status).toBe('failed')
    }, 120_000)

    it('continues from the attempt a dead worker was on: never more than maxAttempts model calls', async () => {
      const unit = await createTestUnit(db, { lessons: 1 })
      const lessonId = unit.lessonIds[0]!
      const { runId } = await startRun(deps, {
        unitId: unit.unitId,
        model: TEST_MODEL,
        capUsd: 1,
      })
      // The dead worker made the first model call (attempt 1 of 2) and died before it answered.
      await claimAndDie(runId, lessonId, 1)
      const llm = createFakeLlm({ respond: () => invalidBody() })
      await startWorker(llm, { maxAttempts: 2 })

      const run = await waitForRun(runId, ['completed'], CRASH_POLL)

      // Only the one attempt that was left: 2 model calls in total, not 3.
      expect(llm.calls).toHaveLength(1)
      expect(run.jobs).toEqual([
        expect.objectContaining({ lessonId, status: 'failed', attempts: 2 }),
      ])
      expect((await lessonRow(lessonId)).status).toBe('failed')
    }, 120_000)

    it('fails without a model call when the dead worker had already used every attempt', async () => {
      const unit = await createTestUnit(db, { lessons: 1 })
      const lessonId = unit.lessonIds[0]!
      const { runId } = await startRun(deps, {
        unitId: unit.unitId,
        model: TEST_MODEL,
        capUsd: 1,
      })
      await claimAndDie(runId, lessonId, 2)
      const llm = createFakeLlm()
      await startWorker(llm, { maxAttempts: 2 })

      const run = await waitForRun(runId, ['completed'], CRASH_POLL)

      expect(llm.calls).toHaveLength(0)
      expect(run.jobs).toEqual([
        expect.objectContaining({ lessonId, status: 'failed', attempts: 2 }),
      ])
      expect(run.jobs[0]!.error ?? '').not.toBe('')
      const row = await lessonRow(lessonId)
      expect(row.status).toBe('failed')
      expect(row.content).toBeNull()
    }, 120_000)
  })

  describe('caps account for in-flight jobs (R12, D-045 (3))', () => {
    /** Fake answers cost exactly one lesson estimate; calls wait for `gate` when given. */
    function estimateSizedLlm(gate?: Promise<void>): FakeLlm {
      return createFakeLlm({
        usage: ESTIMATED_TOKENS_PER_LESSON,
        respond: async () => {
          await gate
          return coreLessonBody()
        },
      })
    }

    it('a run near its cap with concurrency 4 overshoots by at most one lesson estimate', async () => {
      expect(LESSON_ESTIMATE_USD).toBeCloseTo(0.216, 10)
      const unit = await createTestUnit(db, { lessons: 10 })
      const capUsd = 2.5 * LESSON_ESTIMATE_USD
      const gate = createGate()
      const llm = estimateSizedLlm(gate.promise)
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd })
      await startWorker(llm, { concurrency: 4 })

      // Hold every call in flight long enough for all four slots to fill if nothing stops them.
      await expect.poll(() => llm.calls.length, POLL).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      const startedWhileHeld = llm.calls.length
      gate.release()
      const run = await waitForRun(runId, ['stopped_cap'])

      // Reserving an estimate per started job: 3 starts fit under 2.5 estimates, a 4th does not.
      expect(startedWhileHeld).toBeLessThanOrEqual(3)
      expect(run.costUsd).toBeLessThanOrEqual(capUsd + LESSON_ESTIMATE_USD + 1e-9)
      // The budget was used, not given up early.
      expect(run.costUsd).toBeGreaterThanOrEqual(capUsd)
      expect(unfinished(run)).toEqual([])
    }, 60_000)

    it('the global budget counts jobs in flight in every run and worker', async () => {
      const unitA = await createTestUnit(db, { lessons: 5 })
      const unitB = await createTestUnit(db, { lessons: 5 })
      const spentBefore = await getTotalSpendUsd(db)
      const globalCapUsd = spentBefore + 2.5 * LESSON_ESTIMATE_USD
      const gate = createGate()
      const llm = estimateSizedLlm(gate.promise)
      const runA = await startRun(deps, { unitId: unitA.unitId, model: TEST_MODEL, capUsd: 100 })
      const runB = await startRun(deps, { unitId: unitB.unitId, model: TEST_MODEL, capUsd: 100 })
      // Two worker processes, two model calls each: four in flight across the deployment.
      const bossA = newBoss()
      const bossB = newBoss()
      extraBosses.push(bossA, bossB)
      await Promise.all([bossA.start(), bossB.start()])
      await startWorker(llm, { concurrency: 2, globalCapUsd, on: bossA })
      await startWorker(llm, { concurrency: 2, globalCapUsd, on: bossB })

      await expect.poll(() => llm.calls.length, POLL).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      const startedWhileHeld = llm.calls.length
      gate.release()
      const [a, b] = await Promise.all([
        waitForRun(runA.runId, ['stopped_cap', 'completed']),
        waitForRun(runB.runId, ['stopped_cap', 'completed']),
      ])
      await new Promise((resolve) => setTimeout(resolve, 1_500))

      expect(startedWhileHeld).toBeLessThanOrEqual(3)
      const spent = (await getTotalSpendUsd(db)) - spentBefore
      expect(spent).toBeLessThanOrEqual(2.5 * LESSON_ESTIMATE_USD + LESSON_ESTIMATE_USD + 1e-9)
      expect(spent).toBeGreaterThanOrEqual(2.5 * LESSON_ESTIMATE_USD)
      expect(unfinished((await getRun(db, a.id))!)).toEqual([])
      expect(unfinished((await getRun(db, b.id))!)).toEqual([])
    }, 60_000)

    it('releases a reservation when the job finishes: a run whose estimate is above its cap still spends up to the cap', async () => {
      // Real calls cost $0.01 against a $0.216 estimate, so a held reservation must not stop the run.
      const unit = await createTestUnit(db, { lessons: 10 })
      const capUsd = 5 * TEST_CALL_COST
      const llm = createFakeLlm({ delayMs: 100 })
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd })
      await startWorker(llm, { concurrency: 4 })

      const run = await waitForRun(runId, ['stopped_cap', 'completed'])

      expect(run.status).toBe('stopped_cap')
      expect(run.costUsd).toBeGreaterThanOrEqual(capUsd - 1e-9)
      expect(run.costUsd).toBeLessThanOrEqual(capUsd + LESSON_ESTIMATE_USD + 1e-9)
      expect(unfinished(run)).toEqual([])
    })
  })

  describe('prompt polish the worker enforces (R7, D-045 (4))', () => {
    it('retries with a repair hint when the correct pulse check option is the longest', async () => {
      const unit = await createTestUnit(db, { lessons: 1 })
      const llm = createFakeLlm({
        respond: (_request, call) => (call.index === 0 ? longestCorrectBody() : coreLessonBody()),
      })
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      await startWorker(llm, { maxAttempts: 2 })

      const run = await waitForRun(runId, ['completed'])

      expect(llm.calls).toHaveLength(2)
      const hints = polishHints({
        schemaVersion: 1,
        frontMatter: coreFrontMatter(),
        body: longestCorrectBody(),
      })
      expect(hints.length).toBeGreaterThan(0)
      const retry = llm.calls[1]!.request
      hints.forEach((hint: string) => expect(`${retry.system}\n${retry.prompt}`).toContain(hint))
      expect(run.jobs[0]).toEqual(
        expect.objectContaining({ status: 'generated', attempts: 2, tokensIn: 2000 }),
      )
      expect(run.costUsd).toBeCloseTo(2 * TEST_CALL_COST, 10)
    })

    it('saves the last attempt anyway: polish never fails a valid lesson', async () => {
      const unit = await createTestUnit(db, { lessons: 1 })
      const llm = createFakeLlm({ respond: () => longestCorrectBody() })
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      await startWorker(llm, { maxAttempts: 2 })

      const run = await waitForRun(runId, ['completed'])

      expect(llm.calls).toHaveLength(2)
      expect(run.jobs[0]).toEqual(expect.objectContaining({ status: 'generated', attempts: 2 }))
      expect((await lessonRow(unit.lessonIds[0]!)).status).toBe('draft')
    })
  })

  describe('malformed JSON from the model (R7, Sonnet probe)', () => {
    let fake: { stop(): Promise<void> }
    const fakeUrl = `http://localhost:${FAKE_ANTHROPIC_PORT}`
    const savedBaseUrl = process.env.ANTHROPIC_BASE_URL

    beforeAll(async () => {
      fake = await startFakeAnthropic(FAKE_ANTHROPIC_PORT)
      process.env.ANTHROPIC_BASE_URL = fakeUrl
    })
    afterAll(async () => {
      if (savedBaseUrl === undefined) {
        delete process.env.ANTHROPIC_BASE_URL
      } else {
        process.env.ANTHROPIC_BASE_URL = savedBaseUrl
      }
      await fake.stop()
    })

    it('is repaired by the retry, and both calls are charged to the job and the run', async () => {
      const valid = JSON.stringify(coreLessonBody())
      // What the probe saw: an unescaped quote inside a string breaks the whole answer.
      const malformed = valid.replace(
        '"title":"Placeholder Lesson: Claims and Details"',
        '"title":"Placeholder Lesson: "Claims" and Details"',
      )
      expect(malformed).not.toBe(valid)
      await fetch(`${fakeUrl}/__fake/reset`, { method: 'POST' })
      await fetch(`${fakeUrl}/__fake/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ responses: [{ text: malformed }, { text: valid }] }),
      })
      const unit = await createTestUnit(db, { lessons: 1 })
      const lessonId = unit.lessonIds[0]!
      const llm = createAnthropicLlmClient({ apiKey: 'test-key-not-real' })
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      await startWorker(llm, { maxAttempts: 2 })

      const run = await waitForRun(runId, ['completed'])

      const { requests } = (await (await fetch(`${fakeUrl}/__fake/requests`)).json()) as {
        requests: { system: string; prompt: string }[]
      }
      expect(requests).toHaveLength(2)
      // The repair prompt says the answer was not valid JSON.
      expect(requests[1]!.prompt).toMatch(/not valid JSON/i)
      expect(run.jobs).toEqual([
        expect.objectContaining({
          lessonId,
          status: 'generated',
          attempts: 2,
          error: null,
          tokensIn: 2000,
          tokensOut: 2000,
        }),
      ])
      expect(run.jobs[0]!.costUsd).toBeCloseTo(2 * TEST_CALL_COST, 10)
      expect(run.costUsd).toBeCloseTo(2 * TEST_CALL_COST, 10)
      const generation = await getLessonGeneration(db, lessonId)
      expect(generation).toEqual(expect.objectContaining({ tokensIn: 2000, tokensOut: 2000 }))
      expect(generation!.costUsd).toBeCloseTo(2 * TEST_CALL_COST, 10)
      const row = await lessonRow(lessonId)
      expect(row.status).toBe('draft')
      expect(row.content).not.toBeNull()
    })
  })
})
