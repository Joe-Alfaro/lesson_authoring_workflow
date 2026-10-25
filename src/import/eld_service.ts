import { asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client'
import { arcs, lessons, units } from '../db/schema'
import { matchEldRows, parseEldFile, type EldFields } from './parse_eld'
import { isUuid } from './is_uuid'
import type { ImportWarning } from './parse_outline'

export class UnitNotFoundError extends Error {
  constructor(unitId: string) {
    super(`Unit ${unitId} does not exist.`)
    this.name = 'UnitNotFoundError'
  }
}

/**
 * R5: attaches an ELD scope-and-sequence file to a unit. Replaces any earlier ELD input and
 * unmatched-row warnings; only matched rows with at least one non-empty field are stored.
 */
export async function attachEldFile(
  db: Database,
  unitId: string,
  csv: string,
): Promise<{ matched: number; warnings: ImportWarning[] }> {
  const rows = parseEldFile(csv)
  return db.transaction(async (tx) => {
    const unit = isUuid(unitId)
      ? (await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)))[0]
      : undefined
    if (!unit) {
      throw new UnitNotFoundError(unitId)
    }
    const items = await tx
      .select({
        id: lessons.id,
        position: lessons.position,
        lessonType: lessons.lessonType,
        lessonNumber: lessons.lessonNumber,
        arcName: arcs.name,
      })
      .from(lessons)
      .innerJoin(arcs, eq(arcs.id, lessons.arcId))
      .where(eq(lessons.unitId, unitId))
      .orderBy(asc(lessons.position))
    const { matches, warnings } = matchEldRows(rows, items)
    const idByPosition = new Map(items.map((item) => [item.position, item.id]))

    await tx.update(lessons).set({ eldInput: null }).where(eq(lessons.unitId, unitId))
    await Promise.all(
      matches
        .filter((match) => Object.keys(match.fields).length > 0)
        .map((match) =>
          tx
            .update(lessons)
            .set({ eldInput: match.fields })
            .where(eq(lessons.id, idByPosition.get(match.position)!)),
        ),
    )
    await tx.update(units).set({ eldWarnings: warnings }).where(eq(units.id, unitId))
    return { matched: matches.length, warnings }
  })
}

/** The unmatched-row warnings of the unit's last ELD file; `[]` when none or the unit is unknown. */
export async function getUnitEldWarnings(db: Database, unitId: string): Promise<ImportWarning[]> {
  if (!isUuid(unitId)) {
    return []
  }
  const [row] = await db
    .select({ eldWarnings: units.eldWarnings })
    .from(units)
    .where(eq(units.id, unitId))
  return row?.eldWarnings ?? []
}

/** The stored ELD fields of a lesson, or null when it has none. Generation (M2) reads this. */
export async function getLessonEldInput(db: Database, lessonId: string): Promise<EldFields | null> {
  const [row] = await db
    .select({ eldInput: lessons.eldInput })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
  return row?.eldInput ?? null
}
