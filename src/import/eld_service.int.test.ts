// R5: attach an ELD scope-and-sequence file to an imported unit; matched, non-empty fields are
// stored as generation input. Fixture rows: tests/fixtures/import/README.md.
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import {
  STANDARDS_DIR,
  filledEldCsv,
  sampleEldCsv,
  sampleOutlineCsv,
} from '../../tests/import_fixtures'
import { runMigrations } from '../db/migrate'
import { arcs, lessons, units } from '../db/schema'
import { loadStandards } from '../db/seed/standards'
import { attachEldFile, getLessonEldInput } from './eld_service'
import { confirmImport, previewImport } from './import_service'

describe('ELD file (R5)', () => {
  const { pool, db } = connectTestDb()
  let unitId: string

  beforeAll(async () => {
    await runMigrations(pool)
    await loadStandards(db, STANDARDS_DIR)
  })
  afterAll(() => pool.end())
  beforeEach(async () => {
    await db.delete(units)
    const preview = await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() }, {})
    unitId = (await confirmImport(db, preview.importId, {})).unitId
  })

  async function lessonId(lessonNumber: number) {
    const [row] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(eq(lessons.unitId, unitId), eq(lessons.lessonNumber, lessonNumber)))
    return row!.id
  }

  async function firstFlexIn(arcName: string) {
    const [row] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(arcs, eq(arcs.id, lessons.arcId))
      .where(and(eq(lessons.unitId, unitId), eq(lessons.isFlex, true), eq(arcs.name, arcName)))
      .orderBy(asc(lessons.position))
      .limit(1)
    return row!.id
  }

  it('stores the non-empty fields of matched rows and warns about unmatched rows', async () => {
    const result = await attachEldFile(db, unitId, filledEldCsv())

    expect(result.matched).toBe(7)
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings.map((warning) => warning.message).join('\n')).toContain(
      'L19B_DELD_TE_G6_U4_CA_Core',
    )

    expect(await getLessonEldInput(db, await lessonId(1))).toEqual({
      eldStandards: 'ELD.PI.6.6',
      languageObjective:
        'Students explain what a myth is using the frame “A myth is a story that…”.',
      ideasLaunch: 'Turn and talk: name a story that explains something in nature.',
      routines: 'Think-Pair-Share: oral rehearsal before writing.',
    })
    expect(await getLessonEldInput(db, await lessonId(3))).toEqual({
      contentObjective: 'Students identify why an author retells an old story.',
    })
    expect(await getLessonEldInput(db, await lessonId(11))).toEqual({
      ideasLookBack: "Partners check each other's transitions with a checklist.",
    })
    expect(await getLessonEldInput(db, await firstFlexIn('Investigation 2'))).toEqual({
      ideasLaunch: 'Quick review game with unit vocabulary.',
    })
  })

  it('ignores empty fields: a matched row with no content and unmatched lessons store nothing', async () => {
    await attachEldFile(db, unitId, filledEldCsv())

    expect(await getLessonEldInput(db, await lessonId(4))).toBeNull()
    expect(await getLessonEldInput(db, await lessonId(2))).toBeNull()
  })

  it('stores nothing from the sample ELD tab, whose content columns are empty', async () => {
    await attachEldFile(db, unitId, sampleEldCsv())

    for (const number of [1, 4, 20, 41]) {
      expect(await getLessonEldInput(db, await lessonId(number))).toBeNull()
    }
  })

  it('rejects a file for a unit that does not exist', async () => {
    await expect(
      attachEldFile(db, '00000000-0000-4000-8000-000000000000', filledEldCsv()),
    ).rejects.toThrow()
  })
})
