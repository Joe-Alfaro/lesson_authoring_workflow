// Per-lesson generation status and a live feed (R9). Contract: src/generation/README.md.
// Status changes are published with Postgres NOTIFY on one channel; subscribers LISTEN on a
// dedicated pool connection and filter by unit.
import { asc, desc, eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import type { Database } from '../db/client'
import { generationJobs, generationRuns, lessons } from '../db/schema'

export const PROGRESS_CHANNEL = 'generation_progress'

export const LESSON_GENERATION_STATUSES = [
  'not_started',
  'queued',
  'generating',
  'generated',
  'failed',
  'cancelled',
] as const
export type LessonGenerationStatus = (typeof LESSON_GENERATION_STATUSES)[number]

export interface LessonProgressEvent {
  type: 'lesson'
  unitId: string
  lessonId: string
  lessonNumber: number | null
  status: LessonGenerationStatus
}

export interface UnitProgress {
  lessons: {
    lessonId: string
    lessonNumber: number | null
    isFlex: boolean
    status: LessonGenerationStatus
    error: string | null
  }[]
  counts: Record<LessonGenerationStatus, number>
  run: { id: string; status: string; statusLabel: string; costUsd: number; capUsd: number } | null
}

/** Unit-page label for a run status. */
export function runStatusLabel(status: string): string {
  return status === 'stopped_cap' ? 'stopped: spend cap reached' : status
}

/** Anything that can run a query: the Drizzle client or a transaction. */
type Executor = Pick<Database, 'execute'>

export async function notifyLessonProgress(
  db: Executor,
  event: Omit<LessonProgressEvent, 'type'>,
): Promise<void> {
  const payload = JSON.stringify({ type: 'lesson', ...event })
  await db.execute(sql`select pg_notify(${PROGRESS_CHANNEL}, ${payload})`)
}

/** Sends events one at a time: a transaction's client runs one query at a time. */
export async function notifyLessonProgressAll(
  db: Executor,
  events: Omit<LessonProgressEvent, 'type'>[],
): Promise<void> {
  await events.reduce(
    (previous, event) => previous.then(() => notifyLessonProgress(db, event)),
    Promise.resolve(),
  )
}

export async function getUnitProgress(db: Database, unitId: string): Promise<UnitProgress> {
  const latestJobs = db
    .selectDistinctOn([generationJobs.lessonId], {
      lessonId: generationJobs.lessonId,
      status: generationJobs.status,
      error: generationJobs.error,
    })
    .from(generationJobs)
    .innerJoin(lessons, eq(lessons.id, generationJobs.lessonId))
    .where(eq(lessons.unitId, unitId))
    .orderBy(generationJobs.lessonId, desc(generationJobs.createdAt))
    .as('latest_jobs')

  const rows = await db
    .select({
      lessonId: lessons.id,
      lessonNumber: lessons.lessonNumber,
      isFlex: lessons.isFlex,
      status: latestJobs.status,
      error: latestJobs.error,
    })
    .from(lessons)
    .leftJoin(latestJobs, eq(latestJobs.lessonId, lessons.id))
    .where(eq(lessons.unitId, unitId))
    .orderBy(asc(lessons.position))

  const progressLessons = rows.map((row) => ({
    lessonId: row.lessonId,
    lessonNumber: row.lessonNumber,
    isFlex: row.isFlex,
    status: (row.status ?? 'not_started') as LessonGenerationStatus,
    error: row.error ?? null,
  }))

  const counts = Object.fromEntries(
    LESSON_GENERATION_STATUSES.map((status) => [status, 0]),
  ) as Record<LessonGenerationStatus, number>
  progressLessons.forEach((lesson) => {
    counts[lesson.status] += 1
  })

  const [run] = await db
    .select()
    .from(generationRuns)
    .where(eq(generationRuns.unitId, unitId))
    .orderBy(desc(generationRuns.createdAt))
    .limit(1)

  return {
    lessons: progressLessons,
    counts,
    run: run
      ? {
          id: run.id,
          status: run.status,
          statusLabel: runStatusLabel(run.status),
          costUsd: run.costUsd,
          capUsd: run.capUsd,
        }
      : null,
  }
}

function poolOf(db: Database): pg.Pool {
  return (db as Database & { $client: pg.Pool }).$client
}

/** Calls `listener` for every lesson status change in the unit until unsubscribed. */
export async function subscribeToUnitProgress(
  db: Database,
  unitId: string,
  listener: (event: LessonProgressEvent) => void,
): Promise<() => Promise<void>> {
  const client = await poolOf(db).connect()
  let active = true
  function onNotification(message: pg.Notification) {
    if (!active || message.channel !== PROGRESS_CHANNEL || !message.payload) {
      return
    }
    const event = JSON.parse(message.payload) as LessonProgressEvent
    if (event.unitId === unitId) {
      listener(event)
    }
  }
  function onError(error: Error) {
    console.error('[progress] listener connection error:', error.message)
  }
  client.on('notification', onNotification)
  client.on('error', onError)
  await client.query(`LISTEN ${PROGRESS_CHANNEL}`)

  return async () => {
    if (!active) {
      return
    }
    active = false
    client.off('notification', onNotification)
    try {
      await client.query(`UNLISTEN ${PROGRESS_CHANNEL}`)
      client.off('error', onError)
      client.release()
    } catch (error) {
      client.off('error', onError)
      client.release(error instanceof Error ? error : true)
    }
  }
}
