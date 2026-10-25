// Raise a stopped run's spend cap (admin) and resume it (D-024 (1)). The cap stays inside the
// global SPEND_CAP_USD budget; resuming queues only the lessons the cap kept from starting.
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db/client'
import { generationJobs, generationRuns, lessons } from '../db/schema'
import {
  getTotalSpendUsd,
  NotFoundError,
  regenerateLessons,
  type GenerationDeps,
} from '../generation/service'
import { getGlobalSpendCapUsd } from '../generation/settings'
import { isUuid } from '../import/is_uuid'
import { formatUsd } from '../ui/dashboard/format'

/** The run is not in a state that allows the request (answered with 409). */
export class RunStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunStateError'
  }
}

/** A cap the caller can fix: not a number, not above what was spent, or over the budget (400). */
export class InvalidSpendCapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSpendCapError'
  }
}

export interface SpendBudget {
  /** SPEND_CAP_USD: every run's spend counts against it. */
  globalCapUsd: number
  spentUsd: number
  remainingUsd: number
}

export async function getSpendBudget(
  db: Database,
  globalCapUsd = getGlobalSpendCapUsd(),
): Promise<SpendBudget> {
  const spentUsd = await getTotalSpendUsd(db)
  return { globalCapUsd, spentUsd, remainingUsd: Math.max(globalCapUsd - spentUsd, 0) }
}

async function loadRun(db: Database, runId: string) {
  const [run] = isUuid(runId)
    ? await db.select().from(generationRuns).where(eq(generationRuns.id, runId))
    : []
  if (!run) {
    throw new NotFoundError(`Run ${runId}`)
  }
  return run
}

/** The highest cap this run can get: the global budget minus what every other run spent. */
export function maxRunCapUsd(budget: SpendBudget, runCostUsd: number): number {
  return budget.globalCapUsd - (budget.spentUsd - runCostUsd)
}

/** Sets a stopped run's cap; it must be above the run's cost and inside the global budget. */
export async function raiseRunCap(
  db: Database,
  options: { runId: string; capUsd: number; globalCapUsd?: number },
): Promise<{ capUsd: number }> {
  const run = await loadRun(db, options.runId)
  if (run.status !== 'stopped_cap') {
    throw new RunStateError('Only a run stopped by its spend cap can get a higher cap.')
  }
  const { capUsd } = options
  if (!Number.isFinite(capUsd)) {
    throw new InvalidSpendCapError('Enter the cap in dollars, for example 2.50.')
  }
  if (capUsd <= run.costUsd) {
    throw new InvalidSpendCapError(
      `The cap must be more than the ${formatUsd(run.costUsd)} this run has already cost.`,
    )
  }
  const budget = await getSpendBudget(db, options.globalCapUsd)
  const max = maxRunCapUsd(budget, run.costUsd)
  if (capUsd > max + 1e-9) {
    throw new InvalidSpendCapError(
      `The cap can be at most ${formatUsd(max)}: the global budget is ${formatUsd(budget.globalCapUsd)} and ${formatUsd(budget.remainingUsd)} of it is left.`,
    )
  }
  await db.update(generationRuns).set({ capUsd }).where(eq(generationRuns.id, run.id))
  return { capUsd }
}

/**
 * Queues the lessons a stopped run never generated (their jobs were cancelled by the spend
 * guard and they have no content) as a new run on the same model, with the headroom left under
 * the raised cap. Finished lessons are not generated again.
 */
export async function resumeRun(
  deps: GenerationDeps,
  options: { runId: string; userId?: string },
): Promise<{ runId: string; jobCount: number }> {
  const run = await loadRun(deps.db, options.runId)
  if (run.status !== 'stopped_cap') {
    throw new RunStateError('Only a run stopped by its spend cap can be resumed.')
  }
  if (run.capUsd <= run.costUsd) {
    throw new RunStateError("Raise the run's spend cap before resuming.")
  }
  const missing = await deps.db
    .select({ id: lessons.id })
    .from(generationJobs)
    .innerJoin(lessons, eq(lessons.id, generationJobs.lessonId))
    .where(
      and(
        eq(generationJobs.runId, run.id),
        eq(generationJobs.status, 'cancelled'),
        isNull(lessons.content),
      ),
    )
  if (missing.length === 0) {
    throw new RunStateError('Every lesson of this run is generated already.')
  }
  return regenerateLessons(deps, {
    unitId: run.unitId,
    lessonIds: missing.map((row) => row.id),
    model: run.model,
    capUsd: run.capUsd - run.costUsd,
    userId: options.userId,
  })
}
