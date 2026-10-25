import { asc, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import { arcs, lessons, units } from '../db/schema'
import { getUnitEldWarnings } from '../import/eld_service'
import { isUuid } from '../import/is_uuid'
import type { ImportWarning } from '../import/parse_outline'

export interface UnitListItem {
  id: string
  grade: number
  unitNumber: number
  anchorTextTitle: string
  lessons: number
  createdAt: Date
}

/** Every unit, newest first, with its numbered-lesson count (flex days excluded). */
export async function listUnits(db: Database): Promise<UnitListItem[]> {
  return db
    .select({
      id: units.id,
      grade: units.grade,
      unitNumber: units.unitNumber,
      anchorTextTitle: units.anchorTextTitle,
      lessons: sql<number>`count(${lessons.id}) filter (where not ${lessons.isFlex})::int`,
      createdAt: units.createdAt,
    })
    .from(units)
    .leftJoin(lessons, eq(lessons.unitId, units.id))
    .groupBy(units.id)
    .orderBy(desc(units.createdAt))
}

export interface UnitLessonRow {
  id: string
  position: number
  lessonNumber: number | null
  isFlex: boolean
  lessonType: string
  description: string
  arcName: string | null
}

export interface UnitOverview {
  id: string
  grade: number
  unitNumber: number
  anchorTextTitle: string
  isbn: string | null
  banner: string
  arcs: string[]
  lessons: UnitLessonRow[]
  eldWarnings: ImportWarning[]
}

/** A unit with its arcs, lessons in outline order and stored ELD warnings, or null. */
export async function getUnitOverview(db: Database, unitId: string): Promise<UnitOverview | null> {
  if (!isUuid(unitId)) {
    return null
  }
  const [unit] = await db.select().from(units).where(eq(units.id, unitId))
  if (!unit) {
    return null
  }
  const [arcRows, lessonRows, eldWarnings] = await Promise.all([
    db
      .select({ name: arcs.name })
      .from(arcs)
      .where(eq(arcs.unitId, unitId))
      .orderBy(asc(arcs.position)),
    db
      .select({
        id: lessons.id,
        position: lessons.position,
        lessonNumber: lessons.lessonNumber,
        isFlex: lessons.isFlex,
        lessonType: lessons.lessonType,
        description: lessons.description,
        arcName: arcs.name,
      })
      .from(lessons)
      .leftJoin(arcs, eq(arcs.id, lessons.arcId))
      .where(eq(lessons.unitId, unitId))
      .orderBy(asc(lessons.position)),
    getUnitEldWarnings(db, unitId),
  ])
  return {
    id: unit.id,
    grade: unit.grade,
    unitNumber: unit.unitNumber,
    anchorTextTitle: unit.anchorTextTitle,
    isbn: unit.isbn,
    banner: unit.banner,
    arcs: arcRows.map((arc) => arc.name),
    lessons: lessonRows,
    eldWarnings,
  }
}
