// R6, R7, R11, R12: generation runs on pg-boss with a fake LLM. Contract: src/generation/README.md.
// No test calls a real model; every LlmClient here is tests/fake_llm.ts.
import { asc, eq } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import {
  createFakeLlm,
  createGate,
  TEST_CALL_COST,
  TEST_MODEL,
  TEST_PRICES,
  type FakeLlm,
} from '../../tests/fake_llm'
import {
  coreFrontMatter,
  coreLessonBody,
  flexLessonBody,
} from '../../tests/fixtures/lesson/lesson_fixture'
import { createTestUnit, createTestUser } from '../../tests/generation_fixtures'
import { runMigrations } from '../db/migrate'
import { generationRuns, lessons, lessonVersions } from '../db/schema'
import { lessonBodyJsonSchema, LessonContent, validateLesson } from '../lesson/schema'
import { computeCostUsd, ESTIMATED_TOKENS_PER_LESSON, UnknownModelError } from './llm'
import { getCurrentPromptVersion, savePromptVersion } from './prompt_versions'
import { DEFAULT_PROMPT_TEMPLATE } from './prompt_template'
import { ensureGenerationQueue, GENERATE_LESSON_QUEUE } from './queue'
import {
  cancelRun,
  estimateRunCost,
  generateFlexDay,
  getLessonGeneration,
  getRun,
  HumanEditsError,
  regenerateLessons,
  runStatusLabel,
  startRun,
  type GenerationDeps,
} from './service'
import { registerGenerationWorker, type GenerationWorker } from './worker'

const POLL = { timeout: 20_000, interval: 100 }

describe('generation (R6, R7, R11, R12)', () => {
  const { pool, db } = connectTestDb()
  let boss: PgBoss
  let deps: GenerationDeps
  const workers: GenerationWorker[] = []
  const extraBosses: PgBoss[] = []

  function newBoss() {
    return new PgBoss({ connectionString: inject('databaseUrl') })
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
      concurrency: options.concurrency ?? 1,
      maxAttempts: options.maxAttempts ?? 2,
      pollingIntervalSeconds: 0.5,
    })
    workers.push(worker)
    return worker
  }

  async function waitForRun(runId: string, statuses: string[]) {
    await expect.poll(async () => (await getRun(db, runId))?.status, POLL).toBeOneOf(statuses)
    return (await getRun(db, runId))!
  }

  async function lessonRow(id: string) {
    const [row] = await db.select().from(lessons).where(eq(lessons.id, id))
    return row!
  }

  beforeAll(async () => {
    await runMigrations(pool)
    boss = newBoss()
    boss.on('error', (error) => console.error('[test] pg-boss error', error))
    await boss.start()
    deps = { db, boss, prices: TEST_PRICES }
  })
  beforeEach(async () => {
    await ensureGenerationQueue(boss)
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

  describe('startRun (R6)', () => {
    it('queues one job per numbered lesson, not flex days, and returns before any generation', async () => {
      const unit = await createTestUnit(db, { lessons: 3, flexAfter: [3] })

      const started = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })

      expect(started.jobCount).toBe(3)
      const run = await getRun(db, started.runId)
      expect(run).toEqual(
        expect.objectContaining({
          id: started.runId,
          unitId: unit.unitId,
          status: 'queued',
          model: TEST_MODEL,
          capUsd: 1,
          costUsd: 0,
        }),
      )
      expect(run!.jobs.map((job) => job.lessonId).sort()).toEqual([...unit.lessonIds].sort())
      expect(run!.jobs.every((job) => job.status === 'queued')).toBe(true)
    })

    it("pins the run to the unit's current prompt version", async () => {
      const unit = await createTestUnit(db, { lessons: 1 })
      await getCurrentPromptVersion(db, unit.unitId)
      const v2 = await savePromptVersion(db, {
        unitId: unit.unitId,
        template: { ...DEFAULT_PROMPT_TEMPLATE, system: 'v2' },
      })

      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })

      expect((await getRun(db, runId))?.promptVersionId).toBe(v2.id)
    })

    it('estimates the cost before starting (R12)', async () => {
      const unit = await createTestUnit(db, { lessons: 4, flexAfter: [2] })
      const perLesson = computeCostUsd(TEST_MODEL, ESTIMATED_TOKENS_PER_LESSON, TEST_PRICES)

      const estimate = await estimateRunCost(deps, { unitId: unit.unitId, model: TEST_MODEL })

      expect(estimate.lessonCount).toBe(4)
      expect(estimate.estimatedUsd).toBeCloseTo(4 * perLesson, 10)
      const started = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      expect(started.estimatedUsd).toBeCloseTo(estimate.estimatedUsd, 10)
    })

    it('rejects a model without a price and creates no run', async () => {
      const unit = await createTestUnit(db, { lessons: 1 })

      await expect(
        startRun(deps, { unitId: unit.unitId, model: 'unpriced-model', capUsd: 1 }),
      ).rejects.toBeInstanceOf(UnknownModelError)
      expect(
        await db.select().from(generationRuns).where(eq(generationRuns.unitId, unit.unitId)),
      ).toEqual([])
    })
  })

  describe('worker (R6, R7)', () => {
    it('generates and saves every lesson with model, prompt version, tokens and cost', async () => {
      const unit = await createTestUnit(db, { lessons: 3 })
      const llm = createFakeLlm()
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      await startWorker(llm, { concurrency: 2 })

      const run = await waitForRun(runId, ['completed'])

      expect(run.costUsd).toBeCloseTo(3 * TEST_CALL_COST, 10)
      expect(run.finishedAt).toEqual(expect.any(Date))
      expect(run.jobs.every((job) => job.status === 'generated')).toBe(true)
      expect(llm.calls).toHaveLength(3)
      llm.calls.forEach((call) => {
        expect(call.request.model).toBe(TEST_MODEL)
        expect(call.request.schema).toEqual(lessonBodyJsonSchema())
      })

      const promptVersion = await getCurrentPromptVersion(db, unit.unitId)
      await Promise.all(
        unit.lessonIds.map(async (lessonId, index) => {
          const row = await lessonRow(lessonId)
          expect(row.status).toBe('draft')
          const content = LessonContent.parse(row.content)
          expect(validateLesson(content, { focusStandards: ['RL.6.1'], days: 1 }).ok).toBe(true)
          // Front matter comes from the outline row, not the model.
          expect(content.frontMatter).toEqual(
            expect.objectContaining({
              number: index + 1,
              arc: 'Investigation 1',
              type: 'core_reading',
              durationMinutes: 50,
              focusStandards: ['RL.6.1'],
              supportingStandards: ['L.6.4'],
            }),
          )
          expect(content.body.title).toBe(coreLessonBody().title)

          expect(await getLessonGeneration(db, lessonId)).toEqual(
            expect.objectContaining({
              runId,
              model: TEST_MODEL,
              promptVersionId: promptVersion.id,
              promptVersion: promptVersion.version,
              tokensIn: 1000,
              tokensOut: 1000,
              costUsd: TEST_CALL_COST,
              generatedAt: expect.any(Date),
            }),
          )

          const versions = await db
            .select()
            .from(lessonVersions)
            .where(eq(lessonVersions.lessonId, lessonId))
          expect(versions).toHaveLength(1)
          expect(versions[0]!.authorId).toBeNull()
        }),
      )
    })

    it('respects the concurrency setting', async () => {
      const unit = await createTestUnit(db, { lessons: 6 })
      const llm = createFakeLlm({ delayMs: 300 })
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      await startWorker(llm, { concurrency: 2 })

      await waitForRun(runId, ['completed'])

      expect(llm.calls).toHaveLength(6)
      expect(llm.maxInFlight()).toBe(2)
    })

    it('generates a flex day only on request', async () => {
      const unit = await createTestUnit(db, { lessons: 1, flexAfter: [1] })
      const llm = createFakeLlm({
        respond: (_request, call) =>
          call.marker?.startsWith('FLEX') ? flexLessonBody() : coreLessonBody(),
      })
      await startWorker(llm)
      const first = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      await waitForRun(first.runId, ['completed'])
      expect((await lessonRow(unit.flexIds[0]!)).content).toBeNull()
      expect(llm.callsFor('FLEX1')).toHaveLength(0)

      const flex = await generateFlexDay(deps, {
        lessonId: unit.flexIds[0]!,
        model: TEST_MODEL,
        capUsd: 1,
      })
      await waitForRun(flex.runId, ['completed'])

      expect(llm.callsFor('FLEX1')).toHaveLength(1)
      const content = LessonContent.parse((await lessonRow(unit.flexIds[0]!)).content)
      expect(content.frontMatter).toEqual(
        expect.objectContaining({ number: null, type: 'flex', durationMinutes: 50 }),
      )
    })

    it('retries invalid model output, then fails that lesson with the error; others continue', async () => {
      const unit = await createTestUnit(db, { lessons: 3 })
      const invalid = coreLessonBody()
      invalid.sections[0]!.minutes = 10 // 55 minutes in total
      const llm = createFakeLlm({
        respond: (_request, call) => (call.marker === 'Q2' ? invalid : coreLessonBody()),
      })
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      await startWorker(llm, { maxAttempts: 2 })

      const run = await waitForRun(runId, ['completed'])

      const failed = run.jobs.find((job) => job.lessonId === unit.lessonIds[1])!
      expect(failed).toEqual(
        expect.objectContaining({
          status: 'failed',
          attempts: 2,
          error: expect.stringMatching(/minutes/i),
          tokensIn: 2000,
          tokensOut: 2000,
        }),
      )
      expect(llm.callsFor('Q2')).toHaveLength(2)

      // The retry sends the validation errors back to the model.
      const result = validateLesson(
        { schemaVersion: 1, frontMatter: coreFrontMatter(), body: invalid },
        { focusStandards: ['RL.6.1'], days: 1 },
      )
      if (result.ok) {
        throw new Error('fixture should be invalid')
      }
      const retry = llm.callsFor('Q2')[1]!.request
      result.errors.forEach((error) =>
        expect(`${retry.system}\n${retry.prompt}`).toContain(error.message),
      )

      // Never saved as a lesson.
      const row = await lessonRow(unit.lessonIds[1]!)
      expect(row.content).toBeNull()
      expect(row.status).toBe('failed')
      expect(
        await db
          .select()
          .from(lessonVersions)
          .where(eq(lessonVersions.lessonId, unit.lessonIds[1]!)),
      ).toEqual([])

      // The other lessons were generated, and the failed attempts still count toward cost.
      expect(run.jobs.filter((job) => job.status === 'generated')).toHaveLength(2)
      expect(run.costUsd).toBeCloseTo(4 * TEST_CALL_COST, 10)
    })

    it('retries a model call that throws', async () => {
      const unit = await createTestUnit(db, { lessons: 1 })
      const llm = createFakeLlm({
        respond: (_request, call) => {
          if (call.index === 0) {
            throw new Error('rate limited')
          }
          return coreLessonBody()
        },
      })
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      await startWorker(llm, { maxAttempts: 2 })

      const run = await waitForRun(runId, ['completed'])

      expect(run.jobs[0]).toEqual(expect.objectContaining({ status: 'generated', attempts: 2 }))
    })

    it('resumes after a worker restart without redoing finished lessons', async () => {
      const unit = await createTestUnit(db, { lessons: 6 })
      const gate = createGate()
      const llm = createFakeLlm({
        respond: async (_request, call) => {
          if (call.index >= 2) {
            await gate.promise
          }
          return coreLessonBody()
        },
      })
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })

      // Worker A finishes two lessons, is holding a third, and is stopped.
      const bossA = newBoss()
      extraBosses.push(bossA)
      await bossA.start()
      const workerA = await startWorker(llm, { on: bossA })
      await expect.poll(() => llm.calls.length, POLL).toBe(3)
      const stopping = workerA.stop().then(() => bossA.stop({ graceful: true }))
      gate.release()
      await stopping
      const doneByA = new Set(llm.calls.map((call) => call.marker))
      expect(doneByA.size).toBeLessThan(6)

      // Worker B (a fresh process) picks up the rest.
      const bossB = newBoss()
      extraBosses.push(bossB)
      await bossB.start()
      await startWorker(llm, { on: bossB })
      const run = await waitForRun(runId, ['completed'])

      expect(run.jobs.every((job) => job.status === 'generated')).toBe(true)
      expect(llm.calls).toHaveLength(6)
      ;['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'].forEach((marker) =>
        expect(llm.callsFor(marker)).toHaveLength(1),
      )
    })
  })

  describe('spend guard (R12)', () => {
    it('starts no new jobs once the cap is reached and marks the run stopped', async () => {
      const unit = await createTestUnit(db, { lessons: 5 })
      const llm = createFakeLlm()
      const { runId } = await startRun(deps, {
        unitId: unit.unitId,
        model: TEST_MODEL,
        capUsd: 0.025,
      })
      await startWorker(llm, { concurrency: 1 })

      const run = await waitForRun(runId, ['stopped_cap'])
      await new Promise((resolve) => setTimeout(resolve, 1500))

      expect(llm.calls).toHaveLength(3)
      expect(run.statusLabel).toBe('stopped: spend cap reached')
      expect(run.costUsd).toBeCloseTo(3 * TEST_CALL_COST, 10)
      const after = (await getRun(db, runId))!
      expect(after.status).toBe('stopped_cap')
      expect(after.jobs.filter((job) => job.status === 'generated')).toHaveLength(3)
      expect(
        after.jobs.filter((job) => job.status === 'queued' || job.status === 'generating'),
      ).toEqual([])
    })

    it('labels run statuses for the unit page', () => {
      expect(runStatusLabel('stopped_cap')).toBe('stopped: spend cap reached')
      expect(runStatusLabel('cancelled')).toBe('cancelled')
    })
  })

  describe('cancel (R11)', () => {
    it('stops queued jobs and keeps finished lessons', async () => {
      const unit = await createTestUnit(db, { lessons: 4 })
      const gate = createGate()
      const llm = createFakeLlm({
        respond: async (_request, call) => {
          if (call.index === 1) {
            await gate.promise
          }
          return coreLessonBody()
        },
      })
      const { runId } = await startRun(deps, { unitId: unit.unitId, model: TEST_MODEL, capUsd: 1 })
      await startWorker(llm, { concurrency: 1 })
      await expect.poll(() => llm.calls.length, POLL).toBe(2)
      const finished = llm.calls[0]!.marker

      await cancelRun(deps, runId)
      gate.release()
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const run = (await getRun(db, runId))!
      expect(run.status).toBe('cancelled')
      expect(llm.calls).toHaveLength(2)
      expect(run.jobs.filter((job) => job.status === 'cancelled').length).toBeGreaterThanOrEqual(2)
      expect(run.jobs.filter((job) => job.status === 'queued')).toEqual([])

      const finishedIndex = Number(finished!.slice(1)) - 1
      const kept = await lessonRow(unit.lessonIds[finishedIndex]!)
      expect(kept.content).not.toBeNull()
      expect(kept.status).toBe('draft')
    })
  })

  describe('regenerate (R11)', () => {
    async function generateAll(unitId: string) {
      const { runId } = await startRun(deps, { unitId, model: TEST_MODEL, capUsd: 1 })
      return waitForRun(runId, ['completed'])
    }

    it('regenerates one lesson with the current prompt version', async () => {
      const unit = await createTestUnit(db, { lessons: 2 })
      const llm = createFakeLlm()
      await startWorker(llm)
      await generateAll(unit.unitId)
      const v2 = await savePromptVersion(db, {
        unitId: unit.unitId,
        template: { ...DEFAULT_PROMPT_TEMPLATE, system: 'Regenerate with v2.' },
      })

      const { runId, jobCount } = await regenerateLessons(deps, {
        unitId: unit.unitId,
        lessonIds: [unit.lessonIds[0]!],
        model: TEST_MODEL,
        capUsd: 1,
      })
      const run = await waitForRun(runId, ['completed'])

      expect(jobCount).toBe(1)
      expect(run.promptVersionId).toBe(v2.id)
      expect(run.jobs.map((job) => job.lessonId)).toEqual([unit.lessonIds[0]])
      expect(llm.calls.at(-1)!.request.system).toContain('Regenerate with v2.')
      expect((await getLessonGeneration(db, unit.lessonIds[0]!))?.promptVersion).toBe(2)
      expect((await getLessonGeneration(db, unit.lessonIds[1]!))?.promptVersion).toBe(1)
    })

    it('regenerates a selection of lessons', async () => {
      const unit = await createTestUnit(db, { lessons: 3 })
      const llm = createFakeLlm()
      await startWorker(llm)
      await generateAll(unit.unitId)

      const selected = [unit.lessonIds[0]!, unit.lessonIds[2]!]
      const { runId, jobCount } = await regenerateLessons(deps, {
        unitId: unit.unitId,
        lessonIds: selected,
        model: TEST_MODEL,
        capUsd: 1,
      })
      const run = await waitForRun(runId, ['completed'])

      expect(jobCount).toBe(2)
      expect(run.jobs.map((job) => job.lessonId).sort()).toEqual([...selected].sort())
      expect(llm.calls).toHaveLength(5)
    })

    it('regenerates all failed lessons', async () => {
      const unit = await createTestUnit(db, { lessons: 3 })
      const invalid = coreLessonBody()
      invalid.sections[0]!.minutes = 10
      let failQ3 = true
      const llm = createFakeLlm({
        respond: (_request, call) => (failQ3 && call.marker === 'Q3' ? invalid : coreLessonBody()),
      })
      await startWorker(llm, { maxAttempts: 1 })
      await generateAll(unit.unitId)
      expect((await lessonRow(unit.lessonIds[2]!)).status).toBe('failed')
      failQ3 = false

      const { runId, jobCount } = await regenerateLessons(deps, {
        unitId: unit.unitId,
        failed: true,
        model: TEST_MODEL,
        capUsd: 1,
      })
      const run = await waitForRun(runId, ['completed'])

      expect(jobCount).toBe(1)
      expect(run.jobs.map((job) => job.lessonId)).toEqual([unit.lessonIds[2]])
      const row = await lessonRow(unit.lessonIds[2]!)
      expect(row.status).toBe('draft')
      expect(row.content).not.toBeNull()
    })

    it('asks for confirmation before overwriting human edits, then keeps the edited version', async () => {
      const unit = await createTestUnit(db, { lessons: 1 })
      const editorId = await createTestUser(db, 'regenerate-editor@example.com')
      const llm = createFakeLlm()
      await startWorker(llm)
      await generateAll(unit.unitId)
      const lessonId = unit.lessonIds[0]!

      // A reviewer edits the lesson (as the editor would save it).
      const edited = LessonContent.parse((await lessonRow(lessonId)).content)
      edited.body.title = 'Edited by a reviewer'
      await db
        .update(lessons)
        .set({ content: edited, lastEditedBy: editorId, updatedAt: new Date() })
        .where(eq(lessons.id, lessonId))

      const runsBefore = await db
        .select()
        .from(generationRuns)
        .where(eq(generationRuns.unitId, unit.unitId))
      const refused = regenerateLessons(deps, {
        unitId: unit.unitId,
        lessonIds: [lessonId],
        model: TEST_MODEL,
        capUsd: 1,
      })
      await expect(refused).rejects.toBeInstanceOf(HumanEditsError)
      await expect(refused).rejects.toEqual(expect.objectContaining({ lessonIds: [lessonId] }))
      expect(
        await db.select().from(generationRuns).where(eq(generationRuns.unitId, unit.unitId)),
      ).toHaveLength(runsBefore.length)

      const { runId } = await regenerateLessons(deps, {
        unitId: unit.unitId,
        lessonIds: [lessonId],
        model: TEST_MODEL,
        capUsd: 1,
        confirmOverwrite: true,
      })
      await waitForRun(runId, ['completed'])

      const current = LessonContent.parse((await lessonRow(lessonId)).content)
      expect(current.body.title).toBe(coreLessonBody().title)
      const versions = await db
        .select()
        .from(lessonVersions)
        .where(eq(lessonVersions.lessonId, lessonId))
        .orderBy(asc(lessonVersions.createdAt))
      const editedVersion = versions.find(
        (version) => LessonContent.parse(version.content).body.title === 'Edited by a reviewer',
      )
      expect(editedVersion).toBeDefined()
      expect(editedVersion!.authorId).toBe(editorId)
      expect(LessonContent.parse(versions.at(-1)!.content).body.title).toBe(coreLessonBody().title)
    })

    it('does not ask for confirmation when the lesson has no human edits', async () => {
      const unit = await createTestUnit(db, { lessons: 1 })
      const llm = createFakeLlm()
      await startWorker(llm)
      await generateAll(unit.unitId)

      await expect(
        regenerateLessons(deps, {
          unitId: unit.unitId,
          lessonIds: unit.lessonIds,
          model: TEST_MODEL,
          capUsd: 1,
        }),
      ).resolves.toEqual(expect.objectContaining({ jobCount: 1 }))
      const runs = await db
        .select()
        .from(generationRuns)
        .where(eq(generationRuns.unitId, unit.unitId))
      expect(runs).toHaveLength(2)
    })
  })
})
