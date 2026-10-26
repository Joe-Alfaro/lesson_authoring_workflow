// Which prompt version and model generated a lesson at a given time, for the History timeline
// ("generated as Draft with prompt v3, Haiku-class") and the Versions list ("Generated with
// prompt v3"). The worker writes the generated version and finishes its job in one transaction,
// so the job finished closest to that moment (within a couple of minutes) is the one.
import { and, eq } from 'drizzle-orm'
import type { Database } from '../db/client'
import { generationJobs, generationRuns, promptVersions } from '../db/schema'

const MATCH_WINDOW_MS = 2 * 60_000

export interface GeneratedJob {
  at: Date
  promptVersion: number
  model: string
}

export async function generatedJobs(db: Database, lessonId: string): Promise<GeneratedJob[]> {
  const rows = await db
    .select({
      at: generationJobs.updatedAt,
      promptVersion: promptVersions.version,
      model: generationRuns.model,
    })
    .from(generationJobs)
    .innerJoin(generationRuns, eq(generationRuns.id, generationJobs.runId))
    .innerJoin(promptVersions, eq(promptVersions.id, generationRuns.promptVersionId))
    .where(and(eq(generationJobs.lessonId, lessonId), eq(generationJobs.status, 'generated')))
  return rows
}

/** The job finished nearest to `at`, if one finished within the window. */
export function jobNear(jobs: GeneratedJob[], at: Date): GeneratedJob | null {
  const near = jobs
    .map((job) => ({ job, distance: Math.abs(job.at.getTime() - at.getTime()) }))
    .filter((candidate) => candidate.distance <= MATCH_WINDOW_MS)
    .sort((a, b) => a.distance - b.distance)
  return near[0]?.job ?? null
}
