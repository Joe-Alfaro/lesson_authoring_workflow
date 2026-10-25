import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import { lessonVersions, lessons, users } from '../db/schema'
import { isUuid } from '../import/is_uuid'
import { VersionNotFoundError } from './errors'
import {
  assertEditable,
  assertLessonExists,
  insertVersion,
  lockLesson,
  snapshotIfChanged,
} from './lesson_rows'

export interface VersionSummary {
  id: string
  createdAt: Date
  /** Null when generation wrote the version. */
  author: { id: string; name: string } | null
}

export interface LessonVersion extends VersionSummary {
  lessonId: string
  content: unknown
}

const summaryColumns = {
  id: lessonVersions.id,
  createdAt: lessonVersions.createdAt,
  authorId: users.id,
  authorName: users.name,
}

function toSummary(row: {
  id: string
  createdAt: Date
  authorId: string | null
  authorName: string | null
}): VersionSummary {
  return {
    id: row.id,
    createdAt: row.createdAt,
    author:
      row.authorId === null || row.authorName === null
        ? null
        : { id: row.authorId, name: row.authorName },
  }
}

/** The editor's save after 30 s of idle editing (D-024). Does not change the status. */
export async function saveLessonContent(
  db: Database,
  input: { lessonId: string; userId: string; content: unknown },
): Promise<{ versionId: string }> {
  return db.transaction(async (tx) => {
    const lesson = await lockLesson(tx, input.lessonId)
    assertEditable(lesson)
    await tx
      .update(lessons)
      .set({ content: input.content, lastEditedBy: input.userId, updatedAt: sql`now()` })
      .where(eq(lessons.id, lesson.id))
    const versionId = await insertVersion(tx, {
      lessonId: lesson.id,
      content: input.content,
      authorId: input.userId,
    })
    return { versionId }
  })
}

/** Versions newest first, without content (R14). */
export async function listVersions(db: Database, lessonId: string): Promise<VersionSummary[]> {
  await assertLessonExists(db, lessonId)
  const rows = await db
    .select(summaryColumns)
    .from(lessonVersions)
    .leftJoin(users, eq(users.id, lessonVersions.authorId))
    .where(eq(lessonVersions.lessonId, lessonId))
    .orderBy(desc(lessonVersions.createdAt))
  return rows.map(toSummary)
}

/** One version with its content, or null when it is unknown or belongs to another lesson. */
export async function getVersion(
  db: Database,
  input: { lessonId: string; versionId: string },
): Promise<LessonVersion | null> {
  if (!isUuid(input.lessonId) || !isUuid(input.versionId)) {
    return null
  }
  const [row] = await db
    .select({
      ...summaryColumns,
      lessonId: lessonVersions.lessonId,
      content: lessonVersions.content,
    })
    .from(lessonVersions)
    .leftJoin(users, eq(users.id, lessonVersions.authorId))
    .where(and(eq(lessonVersions.id, input.versionId), eq(lessonVersions.lessonId, input.lessonId)))
  if (!row) {
    return null
  }
  return { ...toSummary(row), lessonId: row.lessonId, content: row.content }
}

/**
 * Makes an earlier version the lesson content, appended as a new version by `userId`. Unsaved
 * current content is first kept as a version, so nothing is lost (D-024).
 */
export async function restoreVersion(
  db: Database,
  input: { lessonId: string; versionId: string; userId: string },
): Promise<{ versionId: string }> {
  return db.transaction(async (tx) => {
    const lesson = await lockLesson(tx, input.lessonId)
    assertEditable(lesson)
    const [version] = isUuid(input.versionId)
      ? await tx
          .select({ content: lessonVersions.content })
          .from(lessonVersions)
          .where(
            and(eq(lessonVersions.id, input.versionId), eq(lessonVersions.lessonId, lesson.id)),
          )
      : []
    if (!version) {
      throw new VersionNotFoundError(input.versionId)
    }
    await snapshotIfChanged(tx, lesson, input.userId)
    await tx
      .update(lessons)
      .set({ content: version.content, lastEditedBy: input.userId, updatedAt: sql`now()` })
      .where(eq(lessons.id, lesson.id))
    const versionId = await insertVersion(tx, {
      lessonId: lesson.id,
      content: version.content,
      authorId: input.userId,
    })
    return { versionId }
  })
}
