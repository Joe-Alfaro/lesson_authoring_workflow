import { and, asc, count, eq, inArray, ne, or } from 'drizzle-orm'
import type { Database } from '../db/client'
import { lessons, users } from '../db/schema'
import { isUuid } from '../import/is_uuid'
import { InvalidAssigneeError, LessonNotFoundError } from './errors'

export interface AssignableReviewer {
  id: string
  name: string
  email: string
  role: 'reviewer' | 'approver'
  /** Assigned lessons that are not approved yet. */
  openAssignments: number
}

function isAssignableRole(role: string): role is AssignableReviewer['role'] {
  return role === 'reviewer' || role === 'approver'
}

/**
 * R25: sets (or with null, clears) the assignee of one or many lessons. All or nothing: any
 * unknown lesson id rejects the whole batch.
 */
export async function assignLessons(
  db: Database,
  input: { lessonIds: string[]; assigneeId: string | null },
): Promise<{ updated: number }> {
  const lessonIds = [...new Set(input.lessonIds)]
  if (lessonIds.length === 0) {
    return { updated: 0 }
  }
  const badId = lessonIds.find((id) => !isUuid(id))
  if (badId !== undefined) {
    throw new LessonNotFoundError(badId)
  }
  return db.transaction(async (tx) => {
    if (input.assigneeId !== null) {
      const [assignee] = isUuid(input.assigneeId)
        ? await tx.select({ role: users.role }).from(users).where(eq(users.id, input.assigneeId))
        : []
      if (!assignee || !isAssignableRole(assignee.role)) {
        throw new InvalidAssigneeError()
      }
    }
    const updated = await tx
      .update(lessons)
      .set({ assigneeId: input.assigneeId })
      .where(inArray(lessons.id, lessonIds))
      .returning({ id: lessons.id })
    if (updated.length !== lessonIds.length) {
      const found = new Set(updated.map((row) => row.id))
      throw new LessonNotFoundError(lessonIds.find((id) => !found.has(id))!)
    }
    return { updated: updated.length }
  })
}

/** The assignee picker: reviewers and approvers by name, with their open workload. */
export async function listAssignableReviewers(db: Database): Promise<AssignableReviewer[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      openAssignments: count(lessons.id),
    })
    .from(users)
    .leftJoin(lessons, and(eq(lessons.assigneeId, users.id), ne(lessons.status, 'approved')))
    .where(or(eq(users.role, 'reviewer'), eq(users.role, 'approver')))
    .groupBy(users.id)
    .orderBy(asc(users.name), asc(users.email))
  return rows.flatMap(({ role, ...row }) => (isAssignableRole(role) ? [{ ...row, role }] : []))
}
