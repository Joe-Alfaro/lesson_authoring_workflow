// Which lessons each prompt version generated (R10): a lesson counts for the version of its
// latest generated job, the same provenance getLessonGeneration shows in the lesson bar.
import { inArray, sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import { users } from '../db/schema'

/** Numbered lessons (lesson numbers, ascending) per prompt version id; flex days as null. */
export async function lessonsByPromptVersion(
  db: Database,
  unitId: string,
): Promise<Map<string, (number | null)[]>> {
  const result = await db.execute<{ prompt_version_id: string; lesson_number: number | null }>(sql`
    SELECT latest.prompt_version_id, latest.lesson_number
    FROM (
      SELECT DISTINCT ON (j.lesson_id) r.prompt_version_id, l.lesson_number, l.position
      FROM generation_jobs j
      JOIN generation_runs r ON r.id = j.run_id
      JOIN lessons l ON l.id = j.lesson_id
      WHERE l.unit_id = ${unitId} AND j.status = 'generated'
      ORDER BY j.lesson_id, j.updated_at DESC
    ) latest
    ORDER BY latest.position`)
  const byVersion = new Map<string, (number | null)[]>()
  result.rows.forEach((row) => {
    const list = byVersion.get(row.prompt_version_id) ?? []
    list.push(row.lesson_number)
    byVersion.set(row.prompt_version_id, list)
  })
  return byVersion
}

export async function userNames(db: Database, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map()
  }
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}
