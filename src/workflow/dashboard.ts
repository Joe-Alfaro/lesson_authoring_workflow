import { asc, eq, inArray, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '../db/client'
import { arcs, lessonStatus, lessons, units, users, type LessonStatus } from '../db/schema'
import { isUuid } from '../import/is_uuid'

export interface DashboardUnit {
  id: string
  grade: number
  unitNumber: number
  anchorTextTitle: string
}

export interface DashboardLesson {
  id: string
  lessonNumber: number | null
  isFlex: boolean
  position: number
  /** The generated title once content exists (D-024 (7)), otherwise `outlineLine`. */
  title: string
  /** First line of the outline description. */
  outlineLine: string
  lessonType: string
  arc: { id: string; name: string } | null
  status: LessonStatus
  assignee: { id: string; name: string } | null
  lastEditor: { id: string; name: string } | null
  updatedAt: Date
}

export interface DashboardFilters {
  /** Any of these statuses. */
  status?: LessonStatus[]
  arcId?: string
  /** Null means unassigned. */
  assigneeId?: string | null
}

export type StatusCounts = Record<LessonStatus, number>

export interface UnitDashboard {
  unit: DashboardUnit
  arcs: { id: string; name: string; position: number }[]
  lessons: DashboardLesson[]
  counts: StatusCounts
  total: number
  complete: boolean
}

export interface MyLessons {
  units: { unit: DashboardUnit; counts: StatusCounts; lessons: DashboardLesson[] }[]
}

const assignees = alias(users, 'assignees')
const lastEditors = alias(users, 'last_editors')

function idName(id: string | null, name: string | null): { id: string; name: string } | null {
  return id === null || name === null ? null : { id, name }
}

function generatedTitle(content: unknown): string | null {
  const title = (content as { body?: { title?: unknown } } | null)?.body?.title
  return typeof title === 'string' && title.trim() !== '' ? title : null
}

async function selectLessons(db: Database, where: SQL) {
  const rows = await db
    .select({
      id: lessons.id,
      unitId: lessons.unitId,
      lessonNumber: lessons.lessonNumber,
      isFlex: lessons.isFlex,
      position: lessons.position,
      description: lessons.description,
      content: lessons.content,
      lessonType: lessons.lessonType,
      arcId: arcs.id,
      arcName: arcs.name,
      status: lessons.status,
      assigneeId: assignees.id,
      assigneeName: assignees.name,
      lastEditorId: lastEditors.id,
      lastEditorName: lastEditors.name,
      updatedAt: lessons.updatedAt,
    })
    .from(lessons)
    .leftJoin(arcs, eq(arcs.id, lessons.arcId))
    .leftJoin(assignees, eq(assignees.id, lessons.assigneeId))
    .leftJoin(lastEditors, eq(lastEditors.id, lessons.lastEditedBy))
    .where(where)
    .orderBy(asc(lessons.position))
  return rows.map((row) => {
    const outlineLine = row.description.split('\n')[0]!.trim()
    const lesson: DashboardLesson = {
      id: row.id,
      lessonNumber: row.lessonNumber,
      isFlex: row.isFlex,
      position: row.position,
      title: generatedTitle(row.content) ?? outlineLine,
      outlineLine,
      lessonType: row.lessonType,
      arc: idName(row.arcId, row.arcName),
      status: row.status,
      assignee: idName(row.assigneeId, row.assigneeName),
      lastEditor: idName(row.lastEditorId, row.lastEditorName),
      updatedAt: row.updatedAt,
    }
    return { unitId: row.unitId, lesson }
  })
}

function countByStatus(list: DashboardLesson[]): StatusCounts {
  const counts = Object.fromEntries(lessonStatus.enumValues.map((status) => [status, 0]))
  list.forEach((lesson) => {
    counts[lesson.status]! += 1
  })
  return counts as StatusCounts
}

function matches(lesson: DashboardLesson, filters: DashboardFilters): boolean {
  if (filters.status && !filters.status.includes(lesson.status)) {
    return false
  }
  if (filters.arcId !== undefined && lesson.arc?.id !== filters.arcId) {
    return false
  }
  if (filters.assigneeId !== undefined && (lesson.assignee?.id ?? null) !== filters.assigneeId) {
    return false
  }
  return true
}

const unitColumns = {
  id: units.id,
  grade: units.grade,
  unitNumber: units.unitNumber,
  anchorTextTitle: units.anchorTextTitle,
}

/** R24: a unit's lessons in outline order, filtered; counts and completion stay unit-wide. */
export async function getUnitDashboard(
  db: Database,
  unitId: string,
  filters: DashboardFilters = {},
): Promise<UnitDashboard | null> {
  if (!isUuid(unitId)) {
    return null
  }
  const [unit] = await db.select(unitColumns).from(units).where(eq(units.id, unitId))
  if (!unit) {
    return null
  }
  const unitArcs = await db
    .select({ id: arcs.id, name: arcs.name, position: arcs.position })
    .from(arcs)
    .where(eq(arcs.unitId, unitId))
    .orderBy(asc(arcs.position))
  const all = (await selectLessons(db, eq(lessons.unitId, unitId))).map((row) => row.lesson)
  // Flex days are generated on demand, so they don't hold the unit back.
  const numbered = all.filter((lesson) => !lesson.isFlex)
  const counts = countByStatus(numbered)
  return {
    unit,
    arcs: unitArcs,
    lessons: all.filter((lesson) => matches(lesson, filters)),
    counts,
    total: numbered.length,
    complete: numbered.length > 0 && counts.approved === numbered.length,
  }
}

/** R25 "My lessons": the lessons assigned to the user, grouped by unit. */
export async function getMyLessons(db: Database, userId: string): Promise<MyLessons> {
  if (!isUuid(userId)) {
    return { units: [] }
  }
  const rows = await selectLessons(db, eq(lessons.assigneeId, userId))
  const unitIds = [...new Set(rows.map((row) => row.unitId))]
  if (unitIds.length === 0) {
    return { units: [] }
  }
  const unitRows = await db
    .select(unitColumns)
    .from(units)
    .where(inArray(units.id, unitIds))
    .orderBy(asc(units.grade), asc(units.unitNumber), asc(units.createdAt))
  return {
    units: unitRows.map((unit) => {
      const mine = rows.filter((row) => row.unitId === unit.id).map((row) => row.lesson)
      return { unit, counts: countByStatus(mine), lessons: mine }
    }),
  }
}
