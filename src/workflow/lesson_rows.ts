// Row helpers shared by the workflow service and version history (internal to this folder).
import { isDeepStrictEqual } from 'node:util'
import { desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import { lessonVersions, lessons, type LessonStatus } from '../db/schema'
import { isUuid } from '../import/is_uuid'
import { LessonLockedError, LessonNotFoundError } from './errors'
import { isEditableStatus } from './transitions'

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Executor = Database | Transaction

// Rows written by one call must order strictly, and now() is fixed for the whole transaction.
export const clockNow = sql`clock_timestamp()`

export interface LockedLesson {
  id: string
  status: LessonStatus
  content: unknown
}

/** Reads the lesson and locks its row until the transaction ends. */
export async function lockLesson(tx: Transaction, lessonId: string): Promise<LockedLesson> {
  if (!isUuid(lessonId)) {
    throw new LessonNotFoundError(lessonId)
  }
  const [row] = await tx
    .select({ id: lessons.id, status: lessons.status, content: lessons.content })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .for('update')
  if (!row) {
    throw new LessonNotFoundError(lessonId)
  }
  return row
}

export async function assertLessonExists(db: Executor, lessonId: string): Promise<void> {
  if (!isUuid(lessonId)) {
    throw new LessonNotFoundError(lessonId)
  }
  const [row] = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, lessonId))
  if (!row) {
    throw new LessonNotFoundError(lessonId)
  }
}

export function assertEditable(lesson: { status: LessonStatus }): void {
  if (!isEditableStatus(lesson.status)) {
    throw new LessonLockedError(lesson.status)
  }
}

export async function insertVersion(
  tx: Transaction,
  values: {
    lessonId: string
    content: unknown
    authorId: string | null
    contributorIds?: string[]
  },
): Promise<string> {
  const contributorIds = [...new Set(values.contributorIds ?? [])].filter(
    (id) => id !== values.authorId,
  )
  const [row] = await tx
    .insert(lessonVersions)
    .values({ ...values, contributorIds, createdAt: clockNow })
    .returning({ id: lessonVersions.id })
  return row!.id
}

/**
 * Saves the lesson's current content as a version unless it is empty or equals the latest
 * version (D-024: before submit, approve and restore).
 */
export async function snapshotIfChanged(
  tx: Transaction,
  lesson: LockedLesson,
  authorId: string,
  /** Others who edited since the last version (collab idle versions). */
  contributorIds: string[] = [],
): Promise<boolean> {
  if (lesson.content == null) {
    return false
  }
  const [latest] = await tx
    .select({ content: lessonVersions.content })
    .from(lessonVersions)
    .where(eq(lessonVersions.lessonId, lesson.id))
    .orderBy(desc(lessonVersions.createdAt))
    .limit(1)
  if (latest && isDeepStrictEqual(latest.content, lesson.content)) {
    return false
  }
  await insertVersion(tx, {
    lessonId: lesson.id,
    content: lesson.content,
    authorId,
    contributorIds,
  })
  return true
}
