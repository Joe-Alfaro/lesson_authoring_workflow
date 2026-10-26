// The editor's History timeline (R23-history): status changes and assignments, oldest first, each
// with the sentence the timeline shows after the actor's name. getLessonHistory stays the
// status-only contract of the history route.
import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '../db/client'
import { assignmentEvents, users, type LessonStatus } from '../db/schema'
import { modelLabel } from '../ui/dashboard/format'
import { generatedJobs, jobNear } from './generation_provenance'
import { historyEventText } from './history_text'
import { getLessonHistory } from './service'

export interface TimelineEvent {
  id: string
  kind: 'status' | 'assignment'
  at: Date
  /** Null for the system (generation). */
  actor: { id: string; name: string } | null
  /** What happened, after the actor's name: "submitted for review", "assigned to Reviewer 03". */
  text: string
  note: string | null
  /** The status a status event moved to; null for assignments. */
  toStatus: LessonStatus | null
}

export async function getLessonTimeline(db: Database, lessonId: string): Promise<TimelineEvent[]> {
  const history = await getLessonHistory(db, lessonId)
  const jobs = await generatedJobs(db, lessonId)
  const statusEvents: TimelineEvent[] = history.map((event) => {
    let text = historyEventText(event)
    if (event.fromStatus === 'generating' && event.toStatus === 'draft') {
      const job = jobNear(jobs, event.at)
      if (job) text += ` with prompt v${job.promptVersion}, ${modelLabel(job.model)}`
    }
    return {
      id: event.id,
      kind: 'status',
      at: event.at,
      actor: event.actor ? { id: event.actor.id, name: event.actor.name } : null,
      text,
      note: event.note,
      toStatus: event.toStatus,
    }
  })

  const actor = alias(users, 'actor')
  const assignee = alias(users, 'assignee')
  const rows = await db
    .select({
      id: assignmentEvents.id,
      at: assignmentEvents.at,
      actorId: actor.id,
      actorName: actor.name,
      assigneeName: assignee.name,
      assigneeId: assignmentEvents.assigneeId,
    })
    .from(assignmentEvents)
    .leftJoin(actor, eq(actor.id, assignmentEvents.actorId))
    .leftJoin(assignee, eq(assignee.id, assignmentEvents.assigneeId))
    .where(eq(assignmentEvents.lessonId, lessonId))
    .orderBy(asc(assignmentEvents.at))
  const assignments: TimelineEvent[] = rows.map((row) => ({
    id: row.id,
    kind: 'assignment',
    at: row.at,
    actor: row.actorId && row.actorName ? { id: row.actorId, name: row.actorName } : null,
    text:
      row.assigneeId === null
        ? 'unassigned the lesson'
        : `assigned to ${row.assigneeName ?? 'a former user'}`,
    note: null,
    toStatus: null,
  }))

  // Oldest first; on a tie a status change comes before an assignment.
  return [...statusEvents, ...assignments].sort((a, b) => a.at.getTime() - b.at.getTime())
}
