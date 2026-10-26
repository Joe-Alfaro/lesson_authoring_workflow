// pg-boss handler that generates one lesson per job (R6, R7, R12). Contract:
// src/generation/README.md, section "Worker".
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../db/client'
import { generationJobs, generationRuns, lessons } from '../db/schema'
import {
  lessonBodyJsonSchema,
  lessonDurationMinutes,
  lessonTypeFromOutline,
  validateLesson,
  type LessonContent,
  type LessonFrontMatter,
  type LessonValidationError,
} from '../lesson/schema'
import { computeCostUsd, MODEL_PRICES, type LlmClient, type PriceTable } from './llm'
import {
  notifyLessonProgress,
  notifyLessonProgressAll,
  type LessonGenerationStatus,
} from './progress'
import { textsFromOutline } from './front_matter_texts'
import { normalizeLessonContent, polishHints } from './post_process'
import {
  buildLessonPrompt,
  pulseCheckCorrectOption,
  withoutFocusDuplicates,
  type LessonPromptInput,
} from './prompt_builder'
import { loadLessonPromptInput, type GetEldInput } from './prompt_input'
import {
  ensureGenerationQueue,
  failLostGenerationJobs,
  findExhaustedGenerationJobs,
  GENERATE_LESSON_QUEUE,
  type GenerateLessonJobData,
} from './queue'
import { estimateLessonCostUsd, getTotalSpendUsd } from './service'
import { getGenerationHeartbeatSeconds, getGlobalSpendCapUsd } from './settings'
import { InvalidTransitionError } from '../workflow/errors'
import { insertVersion, snapshotIfChanged } from '../workflow/lesson_rows'
import { applySystemTransition, type SystemStatus } from '../workflow/service'

export interface GenerationWorkerOptions {
  db: Database
  boss: PgBoss
  llm: LlmClient
  /** Model calls at once in this worker. */
  concurrency: number
  /** Attempts per lesson in total (1 = no repair retry). */
  maxAttempts?: number
  prices?: PriceTable
  pollingIntervalSeconds?: number
  getEldInput?: GetEldInput
  /** Global budget across all runs; defaults to SPEND_CAP_USD. */
  globalCapUsd?: number
  /** Output token ceiling per call. */
  maxTokens?: number
  /** Queue heartbeat window; defaults to GENERATION_HEARTBEAT_SECONDS. */
  heartbeatSeconds?: number
}

export interface GenerationWorker {
  /** Stops fetching jobs and waits for in-flight ones. */
  stop(): Promise<void>
}

type JobRow = typeof generationJobs.$inferSelect
type RunRow = typeof generationRuns.$inferSelect

const FINAL_JOB_STATUSES = ['generated', 'failed', 'cancelled'] as const
const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const

/** Output ceiling per call: a lesson is ~7-10k tokens of JSON plus up to ~20k of thinking. */
const DEFAULT_MAX_TOKENS = 64_000

/** Advisory lock key that serializes job admission across worker processes (D-055 (3)). */
const ADMISSION_LOCK_KEY = 4_501_255

/** How often a job blocked only by other jobs' reservations checks again. */
const ADMISSION_WAIT_MS = 1_000

/** Why a dead worker's lesson fails once pg-boss has no retry left (D-045 (1)). */
const EXHAUSTED_REASON = 'The worker stopped during generation and no retry is left.'

/**
 * Lesson status moves go through the review workflow (R23) so each one is a workflow event. A
 * lesson already Generating (a job retried after a worker crash) stays Generating.
 */
async function moveLesson(
  db: Database,
  lessonId: string,
  to: SystemStatus,
  note?: string,
): Promise<void> {
  try {
    await applySystemTransition(db, { lessonId, to, note })
  } catch (error) {
    if (!(error instanceof InvalidTransitionError)) {
      throw error
    }
    if (to !== 'generating') {
      console.warn(`[generation] lesson ${lessonId}: ${error.message}`)
    }
  }
}

/** After a failed generation: Failed when there is no content, else back to Draft. */
async function moveLessonAfterFailure(db: Database, lessonId: string, reason: string) {
  const [row] = await db
    .select({ content: lessons.content })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
  if (row?.content == null) {
    await moveLesson(db, lessonId, 'failed', reason)
    return
  }
  await moveLesson(
    db,
    lessonId,
    'draft',
    `Regeneration failed; the previous content was kept. ${reason}`,
  )
}

class GenerationContext {
  readonly maxAttempts: number
  readonly prices: PriceTable
  readonly globalCapUsd: number
  /** Set by `stop()`: a job waiting for budget hands itself back to the queue. */
  stopping = false

  constructor(readonly options: GenerationWorkerOptions) {
    this.maxAttempts = options.maxAttempts ?? 2
    this.prices = options.prices ?? MODEL_PRICES
    this.globalCapUsd = options.globalCapUsd ?? getGlobalSpendCapUsd()
  }

  get db() {
    return this.options.db
  }
}

async function loadJob(db: Database, jobId: string) {
  const [row] = await db
    .select({ job: generationJobs, run: generationRuns, lesson: lessons })
    .from(generationJobs)
    .innerJoin(generationRuns, eq(generationRuns.id, generationJobs.runId))
    .innerJoin(lessons, eq(lessons.id, generationJobs.lessonId))
    .where(eq(generationJobs.id, jobId))
  return row ?? null
}

async function setJobStatus(
  db: Database,
  job: Pick<JobRow, 'id' | 'lessonId'>,
  lesson: { unitId: string; lessonNumber: number | null },
  status: LessonGenerationStatus & JobRow['status'],
  fields: Partial<Pick<JobRow, 'error'>> = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(generationJobs)
      .set({ status, updatedAt: new Date(), ...fields })
      .where(eq(generationJobs.id, job.id))
    await notifyLessonProgress(tx, {
      unitId: lesson.unitId,
      lessonId: job.lessonId,
      lessonNumber: lesson.lessonNumber,
      status,
    })
  })
}

/** Marks the run completed once no job is left to do (a stopped or cancelled run keeps its status). */
async function finishRunIfDone(db: Database, runId: string): Promise<void> {
  await db
    .update(generationRuns)
    .set({ status: 'completed', finishedAt: new Date() })
    .where(
      and(
        eq(generationRuns.id, runId),
        inArray(generationRuns.status, [...ACTIVE_RUN_STATUSES]),
        sql`not exists (select 1 from ${generationJobs} where ${generationJobs.runId} = ${runId} and ${generationJobs.status} in ('queued', 'generating'))`,
      ),
    )
}

/** The spend guard tripped: this and every other queued job of the run is cancelled. */
async function stopRunAtCap(db: Database, run: RunRow): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(generationRuns)
      .set({ status: 'stopped_cap', finishedAt: new Date() })
      .where(
        and(
          eq(generationRuns.id, run.id),
          inArray(generationRuns.status, [...ACTIVE_RUN_STATUSES]),
        ),
      )
    const cancelled = await tx
      .update(generationJobs)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(generationJobs.runId, run.id), eq(generationJobs.status, 'queued')))
      .returning({ lessonId: generationJobs.lessonId })
    if (cancelled.length === 0) {
      return
    }
    const numbers = await tx
      .select({ id: lessons.id, lessonNumber: lessons.lessonNumber })
      .from(lessons)
      .where(
        inArray(
          lessons.id,
          cancelled.map((job) => job.lessonId),
        ),
      )
    await notifyLessonProgressAll(
      tx,
      numbers.map((lesson) => ({
        unitId: run.unitId,
        lessonId: lesson.id,
        lessonNumber: lesson.lessonNumber,
        status: 'cancelled' as const,
      })),
    )
  })
}

async function recordUsage(
  db: Database,
  job: JobRow,
  usage: { inputTokens: number; outputTokens: number },
  costUsd: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(generationJobs)
      .set({
        tokensIn: sql`${generationJobs.tokensIn} + ${usage.inputTokens}`,
        tokensOut: sql`${generationJobs.tokensOut} + ${usage.outputTokens}`,
        costUsd: sql`${generationJobs.costUsd} + ${costUsd}`,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, job.id))
    await tx
      .update(generationRuns)
      .set({ costUsd: sql`${generationRuns.costUsd} + ${costUsd}` })
      .where(eq(generationRuns.id, job.runId))
  })
}

/** Front matter comes from the outline row, not the model. */
export function frontMatterFromOutline(input: LessonPromptInput, title: string): LessonFrontMatter {
  const standards = withoutFocusDuplicates(input.standards)
  const codes = (kind: LessonPromptInput['standards'][number]['kind']) =>
    standards.filter((standard) => standard.kind === kind).map((standard) => standard.code)
  return {
    unitTitle: `Unit ${input.unit.unitNumber}: ${input.unit.anchorTextTitle}`,
    number: input.lesson.isFlex ? null : input.lesson.lessonNumber,
    arc: input.arc?.name ?? '',
    type: lessonTypeFromOutline(input.lesson.lessonType),
    title,
    durationMinutes: lessonDurationMinutes(input.lesson.days),
    focusStandards: codes('focus'),
    supportingStandards: [...codes('supporting'), ...codes('media')],
    eldStandards: codes('eld').map((code) => ({ code, levels: ['Em', 'Ex', 'Br'] })),
    texts: textsFromOutline({
      anchorTextTitle: input.unit.anchorTextTitle,
      author: input.unit.author ?? null,
      description: input.lesson.description,
      textSet: input.lesson.textSet,
    }),
  }
}

function repairPrompt(prompt: string, errors: string[]): string {
  return `${prompt}

# Fix these problems

Your previous answer for this lesson was rejected. Write the whole lesson body again and fix every problem below:
${errors.map((error) => `- ${error}`).join('\n')}`
}

function bodyTitle(output: unknown): string {
  if (output && typeof output === 'object' && 'title' in output) {
    const title = (output as { title: unknown }).title
    return typeof title === 'string' ? title : ''
  }
  return ''
}

type AttemptOutcome = { ok: true; content: LessonContent } | { ok: false; errors: string[] }

async function saveLesson(
  db: Database,
  job: JobRow,
  unitId: string,
  lessonNumber: number | null,
  content: LessonContent,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        status: lessons.status,
        content: lessons.content,
        lastEditedBy: lessons.lastEditedBy,
      })
      .from(lessons)
      .where(eq(lessons.id, job.lessonId))
      .for('update')
    const now = new Date()
    // Overwriting human edits (confirmed in regenerateLessons): keep the edited content as a
    // version first, unless the editor's save (R14) already made it the latest one.
    if (current?.lastEditedBy) {
      await snapshotIfChanged(tx, { id: job.lessonId, ...current }, current.lastEditedBy)
    }
    // Hint-only polish (PM on D-055 (4)): stored for reviewers, never a retry.
    await tx
      .update(lessons)
      .set({ content, polishWarnings: polishHints(content), lastEditedBy: null, updatedAt: now })
      .where(eq(lessons.id, job.lessonId))
    // Same clock as the editor's versions, so "latest version" orders correctly.
    await insertVersion(tx, { lessonId: job.lessonId, content, authorId: null })
    await tx
      .update(generationJobs)
      .set({ status: 'generated', error: null, updatedAt: now })
      .where(eq(generationJobs.id, job.id))
    await notifyLessonProgress(tx, {
      unitId,
      lessonId: job.lessonId,
      lessonNumber,
      status: 'generated',
    })
  })
}

async function generateLesson(ctx: GenerationContext, job: JobRow, run: RunRow): Promise<void> {
  const { llm, getEldInput } = ctx.options
  const db = ctx.db
  const input = await loadLessonPromptInput(db, job.lessonId, {
    promptVersionId: run.promptVersionId,
    getEldInput,
  })
  const built = buildLessonPrompt(input)
  const schema = lessonBodyJsonSchema()
  const expectations = {
    focusStandards: input.standards.filter((s) => s.kind === 'focus').map((s) => s.code),
    days: input.lesson.days,
  }
  const lesson = { unitId: run.unitId, lessonNumber: input.lesson.lessonNumber }

  async function attempt(number: number, previousErrors: string[]): Promise<AttemptOutcome> {
    await db
      .update(generationJobs)
      .set({ attempts: number, updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id))
    const outcome = await callModel(previousErrors)
    if (!outcome.ok) {
      console.warn(
        `[generation] lesson ${job.lessonId} attempt ${number}/${ctx.maxAttempts} rejected: ${outcome.errors.join('; ').slice(0, 1000)}`,
      )
    }
    if (outcome.ok || number >= ctx.maxAttempts) {
      return outcome
    }
    return attempt(number + 1, outcome.errors)
  }

  async function callModel(previousErrors: string[]): Promise<AttemptOutcome> {
    const prompt =
      previousErrors.length > 0 ? repairPrompt(built.prompt, previousErrors) : built.prompt
    try {
      const response = await llm.generateStructured({
        model: run.model,
        system: built.system,
        prompt,
        schema,
        maxTokens: ctx.options.maxTokens ?? DEFAULT_MAX_TOKENS,
      })
      await recordUsage(
        db,
        job,
        response.usage,
        computeCostUsd(run.model, response.usage, ctx.prices),
      )
      const content = {
        schemaVersion: 1,
        frontMatter: frontMatterFromOutline(input, bodyTitle(response.output)),
        body: response.output,
      }
      const result = validateLesson(content, expectations)
      if (result.ok) {
        // Prompt tuning the code enforces (D-039): answer position, part labels, vocabulary.
        const normalized = normalizeLessonContent(result.lesson, {
          pulseCheckCorrectOption: pulseCheckCorrectOption(input.lesson.lessonNumber),
        })
        return { ok: true, content: normalized }
      }
      return {
        ok: false,
        errors: result.errors.map((error: LessonValidationError) => error.message),
      }
    } catch (error) {
      // A call that failed after generating (token limit, refusal, bad JSON) still costs money.
      const usage = (error as { usage?: { inputTokens: number; outputTokens: number } }).usage
      if (usage) {
        await recordUsage(db, job, usage, computeCostUsd(run.model, usage, ctx.prices))
      }
      return { ok: false, errors: [`Model call failed: ${(error as Error).message}`] }
    }
  }

  // `attempts` counts calls over every try of the queue job: a crash retry continues from it, and
  // a dead worker's last call is not paid for again (D-055 (2)).
  const outcome: AttemptOutcome =
    job.attempts >= ctx.maxAttempts
      ? {
          ok: false,
          errors: [
            `No attempts left: the worker stopped during attempt ${job.attempts} of ${ctx.maxAttempts}.`,
          ],
        }
      : await attempt(job.attempts + 1, [])
  if (outcome.ok) {
    await saveLesson(db, job, run.unitId, lesson.lessonNumber, outcome.content)
    await moveLesson(db, job.lessonId, 'draft')
    return
  }
  await db.transaction(async (tx) => {
    await tx
      .update(generationJobs)
      .set({ status: 'failed', error: outcome.errors.join('\n'), updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id))
    await notifyLessonProgress(tx, { ...lesson, lessonId: job.lessonId, status: 'failed' })
  })
  // Invalid output is never saved.
  await moveLessonAfterFailure(
    db,
    job.lessonId,
    `Generation failed after ${ctx.maxAttempts} attempt(s).`,
  )
}

async function processJob(ctx: GenerationContext, jobId: string): Promise<void> {
  const db = ctx.db
  const row = await loadJob(db, jobId)
  if (!row) {
    return
  }
  const { job, run, lesson } = row
  const lessonRef = { unitId: run.unitId, lessonNumber: lesson.lessonNumber }

  // Restart safety: a finished job is never redone.
  if ((FINAL_JOB_STATUSES as readonly string[]).includes(job.status)) {
    return
  }
  if (!(ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) {
    await setJobStatus(db, job, lessonRef, 'cancelled')
    await finishRunIfDone(db, run.id)
    return
  }

  // Spend guard: a job starts only while the run and the global budget have room.
  for (;;) {
    const admission = await admitJob(ctx, job, run.id, lessonRef)
    if (admission === 'start') {
      break
    }
    if (admission === 'inactive') {
      await setJobStatus(db, job, lessonRef, 'cancelled')
      await finishRunIfDone(db, run.id)
      return
    }
    if (admission === 'stop') {
      await setJobStatus(db, job, lessonRef, 'cancelled')
      await stopRunAtCap(db, run)
      return
    }
    if (ctx.stopping) {
      // Not started: another worker picks the job up later.
      await ctx.options.boss.send(GENERATE_LESSON_QUEUE, { jobId } satisfies GenerateLessonJobData)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, ADMISSION_WAIT_MS))
  }
  await moveLesson(db, job.lessonId, 'generating')

  try {
    await generateLesson(ctx, job, run)
  } catch (error) {
    // Database or prompt-loading failure: fail this lesson rather than leave it generating.
    await setJobStatus(db, job, lessonRef, 'failed', { error: (error as Error).message })
    await moveLessonAfterFailure(db, job.lessonId, (error as Error).message)
  } finally {
    await db.update(generationJobs).set({ reservedUsd: 0 }).where(eq(generationJobs.id, job.id))
  }
  await finishRunIfDone(db, run.id)
}

type Admission = 'start' | 'wait' | 'stop' | 'inactive'

/**
 * Starts the job (Generating, one lesson estimate reserved) when the run and the global budget
 * have room for it, counting spend plus the reservations of every other job in flight, in every
 * run and worker process (D-055 (3)). `stop` once real spend reaches a cap; `wait` when only
 * reservations are in the way, since they are released when those jobs finish.
 */
async function admitJob(
  ctx: GenerationContext,
  job: JobRow,
  runId: string,
  lessonRef: { unitId: string; lessonNumber: number | null },
): Promise<Admission> {
  return ctx.db.transaction(async (tx) => {
    // One admission at a time, so two jobs can't both take the last room under a cap.
    await tx.execute(sql`select pg_advisory_xact_lock(${ADMISSION_LOCK_KEY})`)
    const [run] = await tx.select().from(generationRuns).where(eq(generationRuns.id, runId))
    if (!run || !(ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) {
      return 'inactive'
    }
    const spentUsd = await getTotalSpendUsd(tx)
    if (run.costUsd >= run.capUsd || spentUsd >= ctx.globalCapUsd) {
      return 'stop'
    }
    // A crash retry's own leftover reservation doesn't count against it.
    const [reserved] = await tx
      .select({
        run: sql<string>`coalesce(sum(${generationJobs.reservedUsd}) filter (where ${generationJobs.runId} = ${runId}), 0)`,
        all: sql<string>`coalesce(sum(${generationJobs.reservedUsd}), 0)`,
      })
      .from(generationJobs)
      .where(ne(generationJobs.id, job.id))
    if (
      run.costUsd + Number(reserved?.run ?? 0) >= run.capUsd ||
      spentUsd + Number(reserved?.all ?? 0) >= ctx.globalCapUsd
    ) {
      return 'wait'
    }
    const estimateUsd = await estimateLessonCostUsd(tx, run.unitId, run.model, ctx.prices)
    await tx
      .update(generationRuns)
      .set({ status: 'running' })
      .where(and(eq(generationRuns.id, run.id), eq(generationRuns.status, 'queued')))
    await tx
      .update(generationJobs)
      .set({ status: 'generating', reservedUsd: estimateUsd, updatedAt: new Date() })
      .where(
        and(
          eq(generationJobs.id, job.id),
          notInArray(generationJobs.status, [...FINAL_JOB_STATUSES]),
        ),
      )
    await notifyLessonProgress(tx, { ...lessonRef, lessonId: job.lessonId, status: 'generating' })
    return 'start'
  })
}

/** A dead worker's row whose queue job ran out of retries: Failed, and its run can finish. */
async function failExhaustedJob(db: Database, jobId: string): Promise<void> {
  const failed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(generationJobs)
      .set({ status: 'failed', error: EXHAUSTED_REASON, reservedUsd: 0, updatedAt: new Date() })
      .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'generating')))
      .returning({ lessonId: generationJobs.lessonId, runId: generationJobs.runId })
    if (!row) {
      return null
    }
    const [lesson] = await tx
      .select({ unitId: lessons.unitId, lessonNumber: lessons.lessonNumber })
      .from(lessons)
      .where(eq(lessons.id, row.lessonId))
    if (lesson) {
      await notifyLessonProgress(tx, { ...lesson, lessonId: row.lessonId, status: 'failed' })
    }
    return row
  })
  if (!failed) {
    return
  }
  await moveLessonAfterFailure(db, failed.lessonId, EXHAUSTED_REASON)
  await finishRunIfDone(db, failed.runId)
}

/** One sweep pass: fail lost-heartbeat jobs, then settle rows pg-boss gave up on. */
async function sweepGenerationJobs(db: Database, boss: PgBoss): Promise<void> {
  await failLostGenerationJobs(db, boss)
  const exhausted = await findExhaustedGenerationJobs(db, boss)
  for (const jobId of exhausted) {
    await failExhaustedJob(db, jobId)
  }
}

/** Repeatedly runs `sweepGenerationJobs`; returns the stop function. */
function startLostJobSweep(
  db: Database,
  boss: PgBoss,
  heartbeatSeconds: number,
): () => Promise<void> {
  let running: Promise<unknown> = Promise.resolve()
  const timer = setInterval(
    () => {
      running = running
        .then(() => sweepGenerationJobs(db, boss))
        .catch((error: unknown) =>
          console.error('[generation] lost-heartbeat sweep failed', (error as Error).message),
        )
    },
    Math.max(5, heartbeatSeconds / 2) * 1000,
  )
  return async () => {
    clearInterval(timer)
    await running
  }
}

export async function registerGenerationWorker(
  options: GenerationWorkerOptions,
): Promise<GenerationWorker> {
  const ctx = new GenerationContext(options)
  const heartbeatSeconds = options.heartbeatSeconds ?? getGenerationHeartbeatSeconds()
  await ensureGenerationQueue(options.boss, { heartbeatSeconds })
  const workId = await options.boss.work<GenerateLessonJobData>(
    GENERATE_LESSON_QUEUE,
    {
      localConcurrency: options.concurrency,
      batchSize: 1,
      pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
    },
    async (jobs) => {
      await Promise.all(jobs.map((job) => processJob(ctx, job.data.jobId)))
    },
  )
  const stopSweep = startLostJobSweep(options.db, options.boss, heartbeatSeconds)
  return {
    async stop() {
      ctx.stopping = true
      await stopSweep()
      await options.boss.offWork(GENERATE_LESSON_QUEUE, { id: workId, wait: true })
    },
  }
}
