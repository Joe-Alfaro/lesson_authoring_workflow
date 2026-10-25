// pg-boss queue for lesson generation jobs (R6).
import type { PgBoss } from 'pg-boss'

export const GENERATE_LESSON_QUEUE = 'generate-lesson'

/** Payload of a queue job: the `generation_jobs` row it works on. */
export interface GenerateLessonJobData {
  jobId: string
}

export async function ensureGenerationQueue(boss: PgBoss): Promise<void> {
  // Our own job rows track attempts; pg-boss retries only cover a worker that died mid-job.
  await boss.createQueue(GENERATE_LESSON_QUEUE, { retryLimit: 2, retryDelay: 5 })
}
