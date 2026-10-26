// Generation runs: start, estimate, cancel, regenerate, read (R6, R11, R12).
// Contract: src/generation/README.md. Nothing here calls the model; the worker does.
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../db/client'
import { assistCalls, generationJobs, generationRuns, lessons, promptVersions } from '../db/schema'
import { estimateCostUsd, MODEL_PRICES, priceFor, type PriceTable } from './llm'
import { notifyLessonProgressAll, runStatusLabel } from './progress'
import { getCurrentPromptVersion } from './prompt_versions'
import { GENERATE_LESSON_QUEUE, type GenerateLessonJobData } from './queue'
import { getGenerationSettings, getGlobalSpendCapUsd } from './settings'

export { runStatusLabel }

export interface GenerationDeps {
  db: Database
  boss: PgBoss
  /** Defaults to MODEL_PRICES. */
  prices?: PriceTable
  /** Global budget across all runs; defaults to SPEND_CAP_USD. */
  globalCapUsd?: number
}

interface RunOptions {
  model?: string
  capUsd?: number
  userId?: string
}

export class HumanEditsError extends Error {
  constructor(readonly lessonIds: string[]) {
    super(`${lessonIds.length} lesson(s) have human edits; confirm to overwrite them`)
    this.name = 'HumanEditsError'
  }
}

export class GlobalSpendCapError extends Error {
  constructor(
    readonly estimatedUsd: number,
    readonly remainingUsd: number,
  ) {
    super(
      `This run is estimated at $${estimatedUsd.toFixed(2)} but only $${Math.max(remainingUsd, 0).toFixed(2)} of the global LLM budget remains`,
    )
    this.name = 'GlobalSpendCapError'
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = 'NotFoundError'
  }
}

/** Total LLM spend: every generation run plus every AI assist call (D-024, D-046 global cap). */
export async function getTotalSpendUsd(db: Pick<Database, 'select'>): Promise<number> {
  const [runs] = await db
    .select({ total: sql<string>`coalesce(sum(${generationRuns.costUsd}), 0)` })
    .from(generationRuns)
  const [assist] = await db
    .select({ total: sql<string>`coalesce(sum(${assistCalls.costUsd}), 0)` })
    .from(assistCalls)
  return Number(runs?.total ?? 0) + Number(assist?.total ?? 0)
}

/** Average measured cost of this unit's generated lessons on `model`, or null if none (D-024). */
async function measuredCostPerLesson(
  db: Database,
  unitId: string,
  model: string,
): Promise<number | null> {
  const [row] = await db
    .select({
      average: sql<string | null>`avg(${generationJobs.costUsd})`,
    })
    .from(generationJobs)
    .innerJoin(generationRuns, eq(generationRuns.id, generationJobs.runId))
    .where(
      and(
        eq(generationRuns.unitId, unitId),
        eq(generationRuns.model, model),
        eq(generationJobs.status, 'generated'),
      ),
    )
  return row?.average == null ? null : Number(row.average)
}

async function estimateFor(
  deps: GenerationDeps,
  unitId: string,
  model: string,
  lessonCount: number,
): Promise<number> {
  const prices = deps.prices ?? MODEL_PRICES
  priceFor(model, prices)
  const measured = await measuredCostPerLesson(deps.db, unitId, model)
  return measured === null ? estimateCostUsd(model, lessonCount, prices) : measured * lessonCount
}

async function numberedLessonIds(db: Database, unitId: string): Promise<string[]> {
  const rows = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.unitId, unitId), eq(lessons.isFlex, false)))
    .orderBy(asc(lessons.position))
  return rows.map((row) => row.id)
}

export async function estimateRunCost(
  deps: GenerationDeps,
  options: { unitId: string; model?: string },
): Promise<{ lessonCount: number; estimatedUsd: number }> {
  const model = options.model ?? getGenerationSettings().model
  priceFor(model, deps.prices ?? MODEL_PRICES)
  const lessonIds = await numberedLessonIds(deps.db, options.unitId)
  return {
    lessonCount: lessonIds.length,
    estimatedUsd: await estimateFor(deps, options.unitId, model, lessonIds.length),
  }
}

/** Creates a run pinned to the current prompt version with one job per lesson, then queues them. */
async function createRun(
  deps: GenerationDeps,
  unitId: string,
  lessonIds: string[],
  options: RunOptions,
): Promise<{ runId: string; jobCount: number; estimatedUsd: number }> {
  const settings = getGenerationSettings()
  const model = options.model ?? settings.model
  const capUsd = options.capUsd ?? settings.capUsd
  const prices = deps.prices ?? MODEL_PRICES
  priceFor(model, prices)

  const estimatedUsd = await estimateFor(deps, unitId, model, lessonIds.length)
  const globalCapUsd = deps.globalCapUsd ?? getGlobalSpendCapUsd()
  const remainingUsd = globalCapUsd - (await getTotalSpendUsd(deps.db))
  if (remainingUsd <= 0 || estimatedUsd > remainingUsd) {
    throw new GlobalSpendCapError(estimatedUsd, remainingUsd)
  }

  const promptVersion = await getCurrentPromptVersion(deps.db, unitId)
  const { runId, jobs } = await deps.db.transaction(async (tx) => {
    const [run] = await tx
      .insert(generationRuns)
      .values({
        unitId,
        model,
        promptVersionId: promptVersion.id,
        // A run never gets more than what is left of the global budget.
        capUsd: Math.min(capUsd, remainingUsd),
        createdBy: options.userId ?? null,
      })
      .returning({ id: generationRuns.id })
    const inserted =
      lessonIds.length === 0
        ? []
        : await tx
            .insert(generationJobs)
            .values(lessonIds.map((lessonId) => ({ runId: run!.id, lessonId })))
            .returning({ id: generationJobs.id, lessonId: generationJobs.lessonId })
    const numbers = await lessonNumbers(tx, lessonIds)
    await notifyLessonProgressAll(
      tx,
      inserted.map((job) => ({
        unitId,
        lessonId: job.lessonId,
        lessonNumber: numbers.get(job.lessonId) ?? null,
        status: 'queued' as const,
      })),
    )
    if (inserted.length === 0) {
      await tx
        .update(generationRuns)
        .set({ status: 'completed', finishedAt: new Date() })
        .where(eq(generationRuns.id, run!.id))
    }
    return { runId: run!.id, jobs: inserted }
  })

  if (jobs.length > 0) {
    await deps.boss.insert(
      GENERATE_LESSON_QUEUE,
      jobs.map((job) => ({ data: { jobId: job.id } satisfies GenerateLessonJobData })),
    )
  }
  return { runId, jobCount: jobs.length, estimatedUsd }
}

async function lessonNumbers(
  db: Pick<Database, 'select'>,
  lessonIds: string[],
): Promise<Map<string, number | null>> {
  if (lessonIds.length === 0) {
    return new Map()
  }
  const rows = await db
    .select({ id: lessons.id, lessonNumber: lessons.lessonNumber })
    .from(lessons)
    .where(inArray(lessons.id, lessonIds))
  return new Map(rows.map((row) => [row.id, row.lessonNumber]))
}

/** Queues generation of every numbered lesson of the unit (never flex days). */
export async function startRun(
  deps: GenerationDeps,
  options: RunOptions & { unitId: string },
): Promise<{ runId: string; jobCount: number; estimatedUsd: number }> {
  priceFor(options.model ?? getGenerationSettings().model, deps.prices ?? MODEL_PRICES)
  const lessonIds = await numberedLessonIds(deps.db, options.unitId)
  return createRun(deps, options.unitId, lessonIds, options)
}

/** Flex days are generated only on request, one at a time. */
export async function generateFlexDay(
  deps: GenerationDeps,
  options: RunOptions & { lessonId: string },
): Promise<{ runId: string; jobCount: number }> {
  const [lesson] = await deps.db
    .select({ unitId: lessons.unitId, isFlex: lessons.isFlex })
    .from(lessons)
    .where(eq(lessons.id, options.lessonId))
  if (!lesson) {
    throw new NotFoundError(`Lesson ${options.lessonId}`)
  }
  if (!lesson.isFlex) {
    throw new Error('Only flex days can be generated individually; use regenerate for lessons')
  }
  const { runId, jobCount } = await createRun(deps, lesson.unitId, [options.lessonId], options)
  return { runId, jobCount }
}

/**
 * Regenerates the selected lessons, or every lesson in the Failed workflow status (R11), even when
 * a later cancelled run made its latest job `cancelled`.
 */
export async function regenerateLessons(
  deps: GenerationDeps,
  options: RunOptions & {
    unitId: string
    lessonIds?: string[]
    failed?: true
    confirmOverwrite?: boolean
  },
): Promise<{ runId: string; jobCount: number }> {
  priceFor(options.model ?? getGenerationSettings().model, deps.prices ?? MODEL_PRICES)
  const selected = options.failed
    ? (
        await deps.db
          .select({ id: lessons.id })
          .from(lessons)
          .where(and(eq(lessons.unitId, options.unitId), eq(lessons.status, 'failed')))
      ).map((lesson) => lesson.id)
    : (options.lessonIds ?? [])

  const rows =
    selected.length === 0
      ? []
      : await deps.db
          .select({
            id: lessons.id,
            lastEditedBy: lessons.lastEditedBy,
            position: lessons.position,
          })
          .from(lessons)
          .where(and(eq(lessons.unitId, options.unitId), inArray(lessons.id, selected)))
          .orderBy(asc(lessons.position))
  if (rows.length !== new Set(selected).size) {
    throw new NotFoundError('One or more selected lessons')
  }

  const edited = rows.filter((row) => row.lastEditedBy !== null).map((row) => row.id)
  if (edited.length > 0 && options.confirmOverwrite !== true) {
    throw new HumanEditsError(edited)
  }

  const { runId, jobCount } = await createRun(
    deps,
    options.unitId,
    rows.map((row) => row.id),
    options,
  )
  return { runId, jobCount }
}

/** Stops queued jobs; finished lessons are kept and an in-flight call may still finish. */
export async function cancelRun(deps: GenerationDeps, runId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [run] = await tx
      .update(generationRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(
        and(eq(generationRuns.id, runId), inArray(generationRuns.status, ['queued', 'running'])),
      )
      .returning({ unitId: generationRuns.unitId })
    if (!run) {
      return
    }
    const cancelled = await tx
      .update(generationJobs)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(generationJobs.runId, runId), eq(generationJobs.status, 'queued')))
      .returning({ lessonId: generationJobs.lessonId })
    const numbers = await lessonNumbers(
      tx,
      cancelled.map((job) => job.lessonId),
    )
    await notifyLessonProgressAll(
      tx,
      cancelled.map((job) => ({
        unitId: run.unitId,
        lessonId: job.lessonId,
        lessonNumber: numbers.get(job.lessonId) ?? null,
        status: 'cancelled' as const,
      })),
    )
  })
}

export interface RunView {
  id: string
  unitId: string
  status: string
  statusLabel: string
  model: string
  promptVersionId: string
  capUsd: number
  costUsd: number
  finishedAt: Date | null
  jobs: {
    id: string
    lessonId: string
    status: string
    attempts: number
    error: string | null
    tokensIn: number
    tokensOut: number
    costUsd: number
  }[]
}

export async function getRun(db: Database, runId: string): Promise<RunView | null> {
  const [run] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId))
  if (!run) {
    return null
  }
  const jobs = await db
    .select({
      id: generationJobs.id,
      lessonId: generationJobs.lessonId,
      status: generationJobs.status,
      attempts: generationJobs.attempts,
      error: generationJobs.error,
      tokensIn: generationJobs.tokensIn,
      tokensOut: generationJobs.tokensOut,
      costUsd: generationJobs.costUsd,
    })
    .from(generationJobs)
    .innerJoin(lessons, eq(lessons.id, generationJobs.lessonId))
    .where(eq(generationJobs.runId, runId))
    .orderBy(asc(lessons.position))
  return {
    id: run.id,
    unitId: run.unitId,
    status: run.status,
    statusLabel: runStatusLabel(run.status),
    model: run.model,
    promptVersionId: run.promptVersionId,
    capUsd: run.capUsd,
    costUsd: run.costUsd,
    finishedAt: run.finishedAt,
    jobs,
  }
}

export interface LessonGeneration {
  runId: string
  model: string
  promptVersionId: string
  promptVersion: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  generatedAt: Date
}

/** Provenance of the lesson's current generated content: its latest successful job. */
export async function getLessonGeneration(
  db: Database,
  lessonId: string,
): Promise<LessonGeneration | null> {
  const [row] = await db
    .select({
      runId: generationRuns.id,
      model: generationRuns.model,
      promptVersionId: promptVersions.id,
      promptVersion: promptVersions.version,
      tokensIn: generationJobs.tokensIn,
      tokensOut: generationJobs.tokensOut,
      costUsd: generationJobs.costUsd,
      generatedAt: generationJobs.updatedAt,
    })
    .from(generationJobs)
    .innerJoin(generationRuns, eq(generationRuns.id, generationJobs.runId))
    .innerJoin(promptVersions, eq(promptVersions.id, generationRuns.promptVersionId))
    .where(
      and(
        eq(generationJobs.lessonId, lessonId),
        eq(generationJobs.status, 'generated'),
        isNotNull(generationJobs.updatedAt),
      ),
    )
    .orderBy(sql`${generationJobs.updatedAt} desc`)
    .limit(1)
  return row ?? null
}
