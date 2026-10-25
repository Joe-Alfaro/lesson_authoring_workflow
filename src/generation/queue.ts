// pg-boss queue for lesson generation jobs (R6).
import { eq, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../db/client'
import { generationJobs } from '../db/schema'
import { getGenerationHeartbeatSeconds } from './settings'

export const GENERATE_LESSON_QUEUE = 'generate-lesson'

/** Payload of a queue job: the `generation_jobs` row it works on. */
export interface GenerateLessonJobData {
  jobId: string
}

export interface GenerationQueueOptions {
  /** Heartbeat window in seconds; defaults to `GENERATION_HEARTBEAT_SECONDS`. */
  heartbeatSeconds?: number
}

/**
 * Creates the queue, or updates an existing one, so a changed heartbeat applies on the next worker
 * start. A heartbeat rather than a short expiry (D-039): a live call can take minutes, and pg-boss
 * refreshes the heartbeat of a live job on its own, while the job of a dead worker is retried after
 * one window instead of the 15-minute default expiry.
 */
export async function ensureGenerationQueue(
  boss: PgBoss,
  { heartbeatSeconds = getGenerationHeartbeatSeconds() }: GenerationQueueOptions = {},
): Promise<void> {
  // Our own job rows track attempts; pg-boss retries only cover a worker that died mid-job.
  const options = { retryLimit: 2, retryDelay: 5, heartbeatSeconds }
  if (await boss.getQueue(GENERATE_LESSON_QUEUE)) {
    await boss.updateQueue(GENERATE_LESSON_QUEUE, options)
    return
  }
  await boss.createQueue(GENERATE_LESSON_QUEUE, options)
}

/**
 * Fails (so pg-boss retries) the queue job of each `generating` lesson whose worker stopped sending
 * heartbeats. pg-boss checks heartbeats only on its monitor pass (`monitorIntervalSeconds`, default
 * 60 s), so without this a dead worker's lesson would wait up to a minute more (R6, D-040).
 */
export async function failLostGenerationJobs(db: Database, boss: PgBoss): Promise<number> {
  const generating = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(eq(generationJobs.status, 'generating'))
  if (generating.length === 0) {
    return 0
  }
  const result = await db.execute<{ now: Date | string }>(sql`select now() as now`)
  const now = new Date(result.rows[0]!.now).getTime()
  const found = await Promise.all(
    generating.map((row) =>
      boss.findJobs<GenerateLessonJobData>(GENERATE_LESSON_QUEUE, { data: { jobId: row.id } }),
    ),
  )
  const lost = found
    .flat()
    .filter(
      (job) =>
        job.state === 'active' &&
        job.heartbeatOn !== null &&
        job.heartbeatSeconds !== null &&
        new Date(job.heartbeatOn).getTime() + job.heartbeatSeconds * 1000 < now,
    )
    .map((job) => job.id)
  if (lost.length > 0) {
    await boss.fail(GENERATE_LESSON_QUEUE, lost, { message: 'job heartbeat timeout' })
  }
  return lost.length
}
