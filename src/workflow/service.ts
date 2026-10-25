import { and, asc, eq, type SQL } from 'drizzle-orm'
import type { Database } from '../db/client'
import { isUuid } from '../import/is_uuid'
import { lessons, users, workflowEvents, type LessonStatus, type Role } from '../db/schema'
import {
  InvalidTransitionError,
  LessonNotFoundError,
  NoteRequiredError,
  WorkflowForbiddenError,
} from './errors'
import {
  assertEditable,
  assertLessonExists,
  clockNow,
  lockLesson,
  snapshotIfChanged,
  type Transaction,
} from './lesson_rows'
import { isBlankNote, planTransition, type WorkflowAction } from './transitions'

export interface Actor {
  id: string
  role: Role
}

export interface HistoryEvent {
  id: string
  fromStatus: LessonStatus | null
  toStatus: LessonStatus
  actor: { id: string; name: string; role: Role } | null
  note: string | null
  at: Date
}

export type SystemStatus = 'generating' | 'draft' | 'failed'

// D-024: the content is kept as a version before these actions.
const SNAPSHOT_ACTIONS: readonly WorkflowAction[] = ['submit', 'resubmit', 'approve']

async function selectEvents(db: Database | Transaction, where: SQL): Promise<HistoryEvent[]> {
  const rows = await db
    .select({
      id: workflowEvents.id,
      fromStatus: workflowEvents.fromStatus,
      toStatus: workflowEvents.toStatus,
      note: workflowEvents.note,
      at: workflowEvents.at,
      actorId: users.id,
      actorName: users.name,
      actorRole: users.role,
    })
    .from(workflowEvents)
    .leftJoin(users, eq(users.id, workflowEvents.actorId))
    .where(where)
    .orderBy(asc(workflowEvents.at))
  return rows.map(({ actorId, actorName, actorRole, ...event }) => ({
    ...event,
    actor:
      actorId === null || actorName === null || actorRole === null
        ? null
        : { id: actorId, name: actorName, role: actorRole },
  }))
}

async function recordTransition(
  tx: Transaction,
  values: {
    lessonId: string
    from: LessonStatus
    to: LessonStatus
    actorId: string | null
    note: string | null
  },
): Promise<string> {
  // Conditional on the status read, so a concurrent transition cannot be applied twice.
  const updated = await tx
    .update(lessons)
    .set({ status: values.to, updatedAt: clockNow })
    .where(and(eq(lessons.id, values.lessonId), eq(lessons.status, values.from)))
    .returning({ id: lessons.id })
  if (updated.length === 0) {
    throw new InvalidTransitionError('The lesson changed status; reload and try again.')
  }
  const [event] = await tx
    .insert(workflowEvents)
    .values({
      lessonId: values.lessonId,
      fromStatus: values.from,
      toStatus: values.to,
      actorId: values.actorId,
      note: values.note,
      at: clockNow,
    })
    .returning({ id: workflowEvents.id })
  return event!.id
}

/** A review action by a person (R23). Throws and writes nothing when it is not allowed. */
export async function transitionLesson(
  db: Database,
  input: { lessonId: string; action: WorkflowAction; actor: Actor; note?: string | null },
): Promise<{ status: LessonStatus; event: HistoryEvent }> {
  return db.transaction(async (tx) => {
    const lesson = await lockLesson(tx, input.lessonId)
    const plan = planTransition({
      status: lesson.status,
      action: input.action,
      role: input.actor.role,
      note: input.note,
    })
    if (!plan.ok) {
      if (plan.reason === 'forbidden') {
        throw new WorkflowForbiddenError()
      }
      if (plan.reason === 'note_required') {
        throw new NoteRequiredError()
      }
      throw new InvalidTransitionError(`Cannot ${input.action} a lesson in ${lesson.status}.`)
    }
    if (input.action === 'submit' && lesson.content == null) {
      throw new InvalidTransitionError('The lesson has not been generated yet.')
    }
    if (SNAPSHOT_ACTIONS.includes(input.action)) {
      await snapshotIfChanged(tx, lesson, input.actor.id)
    }
    const eventId = await recordTransition(tx, {
      lessonId: lesson.id,
      from: lesson.status,
      to: plan.to,
      actorId: input.actor.id,
      note: isBlankNote(input.note) ? null : input.note!.trim(),
    })
    const [event] = await selectEvents(tx, eq(workflowEvents.id, eventId))
    return { status: plan.to, event: event! }
  })
}

function systemTransitionAllowed(from: LessonStatus, to: SystemStatus): boolean {
  if (to === 'generating') {
    return from !== 'generating'
  }
  return from === 'generating' && (to === 'draft' || to === 'failed')
}

/** Generation's moves (the M2 worker calls this): into Generating, then to Draft or Failed. */
export async function applySystemTransition(
  db: Database,
  input: { lessonId: string; to: SystemStatus; note?: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const lesson = await lockLesson(tx, input.lessonId)
    if (!systemTransitionAllowed(lesson.status, input.to)) {
      throw new InvalidTransitionError(
        `Generation cannot move a lesson from ${lesson.status} to ${input.to}.`,
      )
    }
    await recordTransition(tx, {
      lessonId: lesson.id,
      from: lesson.status,
      to: input.to,
      actorId: null,
      note: isBlankNote(input.note) ? null : input.note!.trim(),
    })
  })
}

/** Every transition of a lesson, oldest first. */
export async function getLessonHistory(db: Database, lessonId: string): Promise<HistoryEvent[]> {
  await assertLessonExists(db, lessonId)
  return selectEvents(db, eq(workflowEvents.lessonId, lessonId))
}

/** The edit lock for every edit path: throws LessonLockedError when approved or generating. */
export async function assertLessonEditable(db: Database, lessonId: string): Promise<void> {
  if (!isUuid(lessonId)) {
    throw new LessonNotFoundError(lessonId)
  }
  const [lesson] = await db
    .select({ status: lessons.status })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
  if (!lesson) {
    throw new LessonNotFoundError(lessonId)
  }
  assertEditable(lesson)
}
