import { isDeepStrictEqual } from 'node:util'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import { lessonVersions, lessons, users } from '../db/schema'
import { isUuid } from '../import/is_uuid'
import { LessonContent } from '../lesson/schema'
import { LessonLockedError, VersionNotFoundError } from './errors'
import { notifyContentReplaced } from './lesson_events'
import {
  assertEditable,
  assertLessonExists,
  insertVersion,
  lockLesson,
  snapshotIfChanged,
} from './lesson_rows'
import { changedAreas } from './version_changes'

export interface VersionSummary {
  id: string
  createdAt: Date
  /** Null when generation wrote the version. */
  author: { id: string; name: string } | null
}

export interface VersionListItem extends VersionSummary {
  /** Areas changed since the previous (older) version (R14); [] for the oldest. */
  changes: string[]
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

/** Versions newest first, without content, each with what it changed (R14). */
export async function listVersions(db: Database, lessonId: string): Promise<VersionListItem[]> {
  await assertLessonExists(db, lessonId)
  const rows = await db
    .select({ ...summaryColumns, content: lessonVersions.content })
    .from(lessonVersions)
    .leftJoin(users, eq(users.id, lessonVersions.authorId))
    .where(eq(lessonVersions.lessonId, lessonId))
    .orderBy(desc(lessonVersions.createdAt))
  const contents = rows.map((row) => LessonContent.safeParse(row.content))
  return rows.map((row, index) => {
    const after = contents[index]!
    const before = contents[index + 1]
    const changes = after.success && before?.success ? changedAreas(before.data, after.data) : []
    return { ...toSummary(row), changes }
  })
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
    // Open editors switch to the restored content; the stored Yjs state is dropped.
    await notifyContentReplaced(tx, lesson.id)
    return { versionId }
  })
}

/**
 * The collab server's store of a validated editor snapshot (R17, R18): sets the content and last
 * editor without a version. Unchanged content writes nothing. Throws LessonLockedError when the
 * lesson is approved or generating (D-032 (1)).
 */
export async function saveEditorSnapshot(
  db: Database,
  input: { lessonId: string; userId: string | null; content: unknown },
): Promise<{ saved: boolean }> {
  return db.transaction(async (tx) => {
    const lesson = await lockLesson(tx, input.lessonId)
    assertEditable(lesson)
    if (isDeepStrictEqual(lesson.content, input.content)) {
      return { saved: false }
    }
    await tx
      .update(lessons)
      .set({
        content: input.content,
        ...(input.userId ? { lastEditedBy: input.userId } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(lessons.id, lesson.id))
    return { saved: true }
  })
}

/**
 * The version after 30 s of idle editing (D-024 (4)): the current content, authored by the last
 * editor, unless it equals the latest version. Nothing for a locked lesson.
 */
export async function saveIdleVersion(
  db: Database,
  input: { lessonId: string; userId: string },
): Promise<{ saved: boolean }> {
  return db.transaction(async (tx) => {
    const lesson = await lockLesson(tx, input.lessonId)
    try {
      assertEditable(lesson)
    } catch (error) {
      if (error instanceof LessonLockedError) return { saved: false }
      throw error
    }
    return { saved: await snapshotIfChanged(tx, lesson, input.userId) }
  })
}
