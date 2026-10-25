// Builds small units directly in the database for generation tests (M2), independent of the M1
// importer. Every numbered lesson is a 1-day Core Reading lesson with focus RL.6.1 and supporting
// L.6.4, which is what tests/fixtures/lesson/lesson_fixture.ts is written for.
import { resolve } from 'node:path'
import type { Database } from '../src/db/client'
import { arcs, lessonStandards, lessons, units, users } from '../src/db/schema'
import { loadStandards } from '../src/db/seed/standards'

export const STANDARDS_FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/standards')

export function questionMarker(lessonNumber: number): string {
  return `Question marker Q${lessonNumber}?`
}

export function flexMarker(index: number): string {
  return `Question marker FLEX${index}?`
}

export interface TestUnitOptions {
  /** Number of numbered lessons, 1..n. */
  lessons: number
  /** Insert one flex day after each of these lesson numbers. */
  flexAfter?: number[]
}

export interface TestUnit {
  unitId: string
  arcId: string
  /** Numbered lesson ids in order: lessonIds[0] is lesson 1. */
  lessonIds: string[]
  /** Flex day ids in outline order. */
  flexIds: string[]
}

export async function loadFixtureStandards(db: Database): Promise<void> {
  await loadStandards(db, STANDARDS_FIXTURE_DIR)
}

export async function createTestUnit(db: Database, options: TestUnitOptions): Promise<TestUnit> {
  await loadFixtureStandards(db)
  const [unit] = await db
    .insert(units)
    .values({
      grade: 6,
      unitNumber: 4,
      anchorTextTitle: 'Placeholder Anchor Novel',
      banner: 'G6, U4',
    })
    .returning({ id: units.id })
  const [arc] = await db
    .insert(arcs)
    .values({
      unitId: unit!.id,
      name: 'Investigation 1',
      description: 'Arc description.',
      position: 0,
    })
    .returning({ id: arcs.id })

  const flexAfter = new Set(options.flexAfter ?? [])
  const rows = Array.from({ length: options.lessons }, (_, i) => i + 1).flatMap((number) => {
    const lesson = { kind: 'lesson' as const, number }
    return flexAfter.has(number) ? [lesson, { kind: 'flex' as const, number }] : [lesson]
  })

  const lessonIds: string[] = []
  const flexIds: string[] = []
  await rows.reduce(async (previous, row, position) => {
    await previous
    const isFlex = row.kind === 'flex'
    const flexIndex = flexIds.length + 1
    const [inserted] = await db
      .insert(lessons)
      .values({
        unitId: unit!.id,
        arcId: arc!.id,
        position,
        filename: isFlex ? `FLEX${flexIndex}_TE` : `L${row.number}_TE`,
        lessonNumber: isFlex ? null : row.number,
        lessonType: isFlex ? 'End-of-Arc Flex Day' : 'Core Reading',
        days: 1,
        textDependentQuestion: isFlex ? flexMarker(flexIndex) : questionMarker(row.number),
        description: isFlex
          ? `Flex day ${flexIndex} description.`
          : `Lesson ${row.number} description.`,
        focusStandards: 'RL.6.1',
        supportingStandards: 'L.6.4',
        rawRow: {},
        isFlex,
      })
      .returning({ id: lessons.id })
    const id = inserted!.id
    if (isFlex) {
      flexIds.push(id)
    } else {
      lessonIds.push(id)
    }
    await db.insert(lessonStandards).values([
      { lessonId: id, code: 'RL.6.1', kind: 'focus', position: 0 },
      { lessonId: id, code: 'L.6.4', kind: 'supporting', position: 0 },
    ])
  }, Promise.resolve())

  return { unitId: unit!.id, arcId: arc!.id, lessonIds, flexIds }
}

export async function createTestUser(db: Database, email: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, name: email, role: 'author', passwordHash: 'x' })
    .onConflictDoUpdate({ target: users.email, set: { name: email } })
    .returning({ id: users.id })
  return user!.id
}
