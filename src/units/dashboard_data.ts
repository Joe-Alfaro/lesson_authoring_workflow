// Everything the unit page (R9-R12, R24, R25) shows, read once per render and sent to the client
// component as plain JSON. Live updates re-run this through router.refresh().
import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import { generationJobs, generationRuns, lessons, promptVersions, users } from '../db/schema'
import type { LessonStatus } from '../db/schema'
import { MODEL_PRICES } from '../generation/llm'
import {
  getUnitProgress,
  type LessonGenerationStatus,
  type UnitProgress,
} from '../generation/progress'
import { getCurrentPromptVersion } from '../generation/prompt_versions'
import { estimateRunCost } from '../generation/service'
import { getGenerationSettings } from '../generation/settings'
import { readOnlyDeps } from '../generation_api/boss'
import { getSpendBudget, maxRunCapUsd, type SpendBudget } from '../generation_api/run_cap'
import { modelLabel } from '../ui/dashboard/format'
import type { RowStatus } from '../ui/dashboard/status_pill'
import { getMyLessons, getUnitDashboard, type DashboardLesson } from '../workflow/dashboard'
import { bannerAuthor } from './banner'
import { outlineTitle } from './outline_title'
import { getUnitOverview } from './queries'

export interface DashboardRow {
  id: string
  lessonNumber: number | null
  isFlex: boolean
  title: string
  outlineLine: string
  lessonType: string
  arcId: string | null
  status: RowStatus
  /** Latest generation job's status ('not_started' without one). */
  generation: LessonGenerationStatus
  /** The latest job's error when it failed. */
  error: string | null
  /** The spend cap stopped the run before this lesson started. */
  stoppedByCap: boolean
  hasContent: boolean
  /** Someone edited the content since it was generated (regenerate asks first, R11). */
  humanEdits: boolean
  assignee: { id: string; name: string } | null
  lastEditor: { id: string; name: string } | null
  updatedAt: string
}

export interface DashboardRun {
  id: string
  status: string
  model: string
  modelLabel: string
  promptVersion: number
  capUsd: number
  costUsd: number
  /** Estimate for the run's lessons at the time of reading (D-024 (2)). */
  estimateUsd: number
  startedBy: string | null
  createdAt: string
  finishedAt: string | null
}

export interface ModelEstimate {
  id: string
  label: string
  /** Expected cost of one lesson on this model for this unit. */
  perLessonUsd: number
}

export interface UnitDashboardData {
  unit: { id: string; heading: string; unitNumber: number; summary: string; shortSummary: string }
  arcs: { id: string; name: string }[]
  rows: DashboardRow[]
  /** Workflow status counts of the numbered lessons (R24). */
  counts: Record<LessonStatus, number>
  total: number
  complete: boolean
  progress: UnitProgress
  run: DashboardRun | null
  prompt: { version: number; savedBy: string | null; savedAt: string }
  settings: { concurrency: number; capUsd: number }
  budget: SpendBudget & { maxCapUsd: number | null }
  /** Default model first. */
  models: ModelEstimate[]
  eldWarnings: string[]
  now: string
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function rowStatus(
  lessonStatus: LessonStatus,
  generation: LessonGenerationStatus,
  hasContent: boolean,
): RowStatus {
  if (generation === 'queued') {
    return 'queued'
  }
  if (generation === 'generating' || lessonStatus === 'generating') {
    return 'generating'
  }
  if (lessonStatus === 'failed' || (generation === 'failed' && !hasContent)) {
    return 'failed'
  }
  return hasContent ? lessonStatus : 'not_generated'
}

async function userName(db: Database, id: string | null): Promise<string | null> {
  if (!id) {
    return null
  }
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, id))
  return row?.name ?? null
}

async function latestRun(
  db: Database,
  progress: UnitProgress,
  perLesson: (model: string) => Promise<number>,
): Promise<DashboardRun | null> {
  if (!progress.run) {
    return null
  }
  const [run] = await db
    .select({
      id: generationRuns.id,
      status: generationRuns.status,
      model: generationRuns.model,
      capUsd: generationRuns.capUsd,
      costUsd: generationRuns.costUsd,
      createdBy: generationRuns.createdBy,
      createdAt: generationRuns.createdAt,
      finishedAt: generationRuns.finishedAt,
      promptVersion: promptVersions.version,
    })
    .from(generationRuns)
    .innerJoin(promptVersions, eq(promptVersions.id, generationRuns.promptVersionId))
    .where(eq(generationRuns.id, progress.run.id))
  if (!run) {
    return null
  }
  const [jobs] = await db
    .select({ n: count() })
    .from(generationJobs)
    .where(eq(generationJobs.runId, run.id))
  return {
    id: run.id,
    status: run.status,
    model: run.model,
    modelLabel: modelLabel(run.model),
    promptVersion: run.promptVersion,
    capUsd: run.capUsd,
    costUsd: run.costUsd,
    estimateUsd: (jobs?.n ?? 0) * (await perLesson(run.model)),
    startedBy: await userName(db, run.createdBy),
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  }
}

export async function getUnitDashboardData(
  db: Database,
  unitId: string,
): Promise<UnitDashboardData | null> {
  const [overview, dashboard] = await Promise.all([
    getUnitOverview(db, unitId),
    getUnitDashboard(db, unitId),
  ])
  if (!overview || !dashboard) {
    return null
  }
  const deps = readOnlyDeps(db)
  const settings = getGenerationSettings()
  const perLessonCache = new Map<string, Promise<number>>()
  function perLesson(model: string): Promise<number> {
    if (!perLessonCache.has(model)) {
      perLessonCache.set(
        model,
        estimateRunCost(deps, { unitId, model }).then(({ lessonCount, estimatedUsd }) =>
          lessonCount > 0 ? estimatedUsd / lessonCount : 0,
        ),
      )
    }
    return perLessonCache.get(model)!
  }

  const [progress, prompt, budget, withContent] = await Promise.all([
    getUnitProgress(db, unitId),
    getCurrentPromptVersion(db, unitId),
    getSpendBudget(db),
    db
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(eq(lessons.unitId, unitId), isNotNull(lessons.content))),
  ])
  const run = await latestRun(db, progress, perLesson)
  const contentIds = new Set(withContent.map((row) => row.id))
  const generationById = new Map(progress.lessons.map((lesson) => [lesson.lessonId, lesson]))
  const stoppedRun = run?.status === 'stopped_cap'
  const outlineById = new Map(
    overview.lessons.map((lesson) => [lesson.id, outlineTitle(lesson.description)]),
  )

  const rows = dashboard.lessons.map((lesson): DashboardRow => {
    const generation = generationById.get(lesson.id)
    const status = generation?.status ?? 'not_started'
    const hasContent = contentIds.has(lesson.id)
    const outline = outlineById.get(lesson.id) ?? lesson.outlineLine
    return {
      id: lesson.id,
      lessonNumber: lesson.lessonNumber,
      isFlex: lesson.isFlex,
      title: hasContent ? lesson.title : outline,
      outlineLine: outline,
      lessonType: lesson.lessonType,
      arcId: lesson.arc?.id ?? null,
      status: rowStatus(lesson.status, status, hasContent),
      generation: status,
      error: status === 'failed' ? (generation?.error ?? null) : null,
      stoppedByCap: stoppedRun && status === 'cancelled' && !hasContent,
      hasContent,
      humanEdits: lesson.lastEditor !== null,
      assignee: lesson.assignee,
      lastEditor: lesson.lastEditor,
      updatedAt: lesson.updatedAt.toISOString(),
    }
  })

  const models = await Promise.all(
    [settings.model, ...Object.keys(MODEL_PRICES).filter((id) => id !== settings.model)].map(
      async (id) => ({ id, label: modelLabel(id), perLessonUsd: await perLesson(id) }),
    ),
  )
  const numbered = overview.lessons.filter((lesson) => !lesson.isFlex).length
  const flexDays = overview.lessons.length - numbered
  const author = bannerAuthor(overview.banner)
  const details = [author && `Anchor text by ${author}`, overview.isbn && `ISBN ${overview.isbn}`]
    .filter(Boolean)
    .join(', ')

  return {
    unit: {
      id: overview.id,
      heading: `Unit ${overview.unitNumber}: ${overview.anchorTextTitle}`,
      unitNumber: overview.unitNumber,
      summary: `Grade ${overview.grade}, ${plural(numbered, 'lesson', 'lessons')} in ${plural(overview.arcs.length, 'arc', 'arcs')}, ${plural(flexDays, 'flex day', 'flex days')}.${details ? ` ${details}.` : ''}`,
      shortSummary: `Grade ${overview.grade}, ${plural(numbered, 'lesson', 'lessons')}`,
    },
    arcs: dashboard.arcs.map((arc) => ({ id: arc.id, name: arc.name })),
    rows,
    counts: dashboard.counts,
    total: dashboard.total,
    complete: dashboard.complete,
    progress,
    run,
    prompt: {
      version: prompt.version,
      savedBy: await userName(db, prompt.createdBy),
      savedAt: prompt.createdAt.toISOString(),
    },
    settings: {
      concurrency: settings.concurrency,
      // createRun clamps a new run's cap to what is left of the global budget.
      capUsd: Math.min(settings.capUsd, budget.remainingUsd),
    },
    budget: { ...budget, maxCapUsd: run ? maxRunCapUsd(budget, run.costUsd) : null },
    models,
    eldWarnings: overview.eldWarnings.map((warning) => warning.message),
    now: new Date().toISOString(),
  }
}

export interface MyLessonsData {
  units: {
    id: string
    heading: string
    counts: Record<LessonStatus, number>
    rows: DashboardRow[]
  }[]
  now: string
}

/** A lesson listed outside its unit page (My lessons): workflow status, no generation detail. */
function plainRow(lesson: DashboardLesson, hasContent: boolean, outline: string): DashboardRow {
  const generation: LessonGenerationStatus = hasContent ? 'generated' : 'not_started'
  return {
    id: lesson.id,
    lessonNumber: lesson.lessonNumber,
    isFlex: lesson.isFlex,
    title: hasContent ? lesson.title : outline,
    outlineLine: outline,
    lessonType: lesson.lessonType,
    arcId: lesson.arc?.id ?? null,
    status: rowStatus(lesson.status, generation, hasContent),
    generation,
    error: null,
    stoppedByCap: false,
    hasContent,
    humanEdits: lesson.lastEditor !== null,
    assignee: lesson.assignee,
    lastEditor: lesson.lastEditor,
    updatedAt: lesson.updatedAt.toISOString(),
  }
}

/** R25: the lessons assigned to the user, grouped by unit, with per-unit status counts. */
export async function getMyLessonsData(db: Database, userId: string): Promise<MyLessonsData> {
  const mine = await getMyLessons(db, userId)
  const ids = mine.units.flatMap((group) => group.lessons.map((lesson) => lesson.id))
  const details =
    ids.length === 0
      ? []
      : await db
          .select({
            id: lessons.id,
            description: lessons.description,
            hasContent: sql<boolean>`${lessons.content} is not null`,
          })
          .from(lessons)
          .where(inArray(lessons.id, ids))
  const byId = new Map(details.map((row) => [row.id, row]))
  return {
    units: mine.units.map((group) => ({
      id: group.unit.id,
      heading: `Unit ${group.unit.unitNumber}: ${group.unit.anchorTextTitle}`,
      counts: group.counts,
      rows: group.lessons.map((lesson) => {
        const row = byId.get(lesson.id)
        return plainRow(
          lesson,
          row?.hasContent ?? false,
          row ? outlineTitle(row.description) : lesson.outlineLine,
        )
      }),
    })),
    now: new Date().toISOString(),
  }
}
