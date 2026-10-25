// R9: per-lesson generation status and a live feed. Contract: src/generation/README.md.
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
import { getUnitProgress, subscribeToUnitProgress, type LessonProgressEvent } from './progress'
import { ensureGenerationQueue, GENERATE_LESSON_QUEUE } from './queue'
import { getRun, startRun, type GenerationDeps } from './service'
import { registerGenerationWorker, type GenerationWorker } from './worker'

const POLL = { timeout: 20_000, interval: 100 }

describe('generation progress (R9)', () => {
  const { pool, db } = connectTestDb()
  let boss: PgBoss
  let deps: GenerationDeps
  const workers: GenerationWorker[] = []
  const unsubscribers: Array<() => Promise<void>> = []

  async function startWorker(llm: FakeLlm) {
    const worker = await registerGenerationWorker({
      db,
      boss,
      llm,
      prices: TEST_PRICES,
      concurrency: 1,
      maxAttempts: 1,
      pollingIntervalSeconds: 0.5,
    })
    workers.push(worker)
  }

  beforeAll(async () => {
    await runMigrations(pool)
    boss = new PgBoss({ connectionString: inject('databaseUrl') })
    boss.on('error', (error) => console.error('[test] pg-boss error', error))
    await boss.start()
    deps = { db, boss, prices: TEST_PRICES }
  })
  beforeEach(async () => {
    await ensureGenerationQueue(boss)
    await boss.deleteAllJobs(GENERATE_LESSON_QUEUE)
  })
  afterEach(async () => {
    await Promise.all(unsubscribers.splice(0).map((unsubscribe) => unsubscribe()))
    await Promise.all(workers.splice(0).map((worker) => worker.stop()))
  })
  afterAll(async () => {
    await boss.stop({ graceful: false })
    await pool.end()
  })

  it('reports each lesson status, counts and the run summary', async () => {
    const unit = await createTestUnit(db, { lessons: 3, flexAfter: [3] })
    const invalid = coreLessonBody()
    invalid.sections[0]!.minutes = 10
    const llm = createFakeLlm({
      respond: (_request, call) => (call.marker === 'Q2' ? invalid : coreLessonBody()),
    })

    const before = await getUnitProgress(db, unit.unitId)
    expect(before.run).toBeNull()
    expect(before.lessons.every((lesson) => lesson.status === 'not_started')).toBe(true)

    const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
    const queued = await getUnitProgress(db, unit.unitId)
    expect(queued.counts).toEqual(expect.objectContaining({ queued: 3, not_started: 1 }))

    await startWorker(llm)
    await expect.poll(async () => (await getRun(db, runId))?.status, POLL).toBe('completed')
    const progress = await getUnitProgress(db, unit.unitId)

    expect(progress.lessons).toHaveLength(4)
    expect(progress.lessons.map((lesson) => [lesson.lessonNumber, lesson.status])).toEqual([
      [1, 'generated'],
      [2, 'failed'],
      [3, 'generated'],
      [null, 'not_started'],
    ])
    expect(progress.lessons[1]).toEqual(
      expect.objectContaining({
        lessonId: unit.lessonIds[1],
        error: expect.stringMatching(/minutes/i),
      }),
    )
    expect(progress.counts).toEqual({
      not_started: 1,
      queued: 0,
      generating: 0,
      generated: 2,
      failed: 1,
      cancelled: 0,
    })
    expect(progress.run).toEqual(
      expect.objectContaining({
        id: runId,
        status: 'completed',
        statusLabel: 'completed',
        costUsd: expect.any(Number),
        capUsd: 1,
      }),
    )
  })

  it('emits lesson status changes within 5 seconds', async () => {
    const unit = await createTestUnit(db, { lessons: 2 })
    const gate = createGate()
    const llm = createFakeLlm({
      respond: async () => {
        await gate.promise
        return coreLessonBody()
      },
    })
    const events: Array<LessonProgressEvent & { receivedAt: number }> = []
    unsubscribers.push(
      await subscribeToUnitProgress(db, unit.unitId, (event) => {
        events.push({ ...event, receivedAt: Date.now() })
      }),
    )

    await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
    await startWorker(llm)
    await expect.poll(() => llm.calls.length, POLL).toBe(1)
    const lessonNumber = Number(llm.calls[0]!.marker!.slice(1))
    const generatingLesson = unit.lessonIds[lessonNumber - 1]!
    await expect
      .poll(
        () => events.some((e) => e.lessonId === generatingLesson && e.status === 'generating'),
        {
          timeout: 5_000,
          interval: 50,
        },
      )
      .toBe(true)

    const releasedAt = Date.now()
    gate.release()
    await expect
      .poll(() => events.find((e) => e.lessonId === generatingLesson && e.status === 'generated'), {
        timeout: 5_000,
        interval: 50,
      })
      .toBeDefined()

    const generated = events.find(
      (e) => e.lessonId === generatingLesson && e.status === 'generated',
    )!
    expect(generated.receivedAt - releasedAt).toBeLessThan(5_000)
    expect(generated).toEqual(
      expect.objectContaining({ type: 'lesson', unitId: unit.unitId, lessonNumber }),
    )
  })

  it('stops emitting after unsubscribe', async () => {
    const unit = await createTestUnit(db, { lessons: 1 })
    const events: LessonProgressEvent[] = []
    const unsubscribe = await subscribeToUnitProgress(db, unit.unitId, (event) =>
      events.push(event),
    )
    await unsubscribe()

    await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(events).toEqual([])
  })
})
