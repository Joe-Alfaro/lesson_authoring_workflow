// R5 / D-028: ELD rows that match no lesson are stored on the unit as warnings so the UI can show
// them after the import. Contract: src/import/README.md.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import {
  STANDARDS_DIR,
  filledEldCsv,
  sampleEldCsv,
  sampleOutlineCsv,
} from '../../tests/import_fixtures'
import { runMigrations } from '../db/migrate'
import { pendingImports, standards, units } from '../db/schema'
import { loadStandards } from '../db/seed/standards'
import { attachEldFile, getUnitEldWarnings } from './eld_service'
import { confirmImport, previewImport } from './import_service'
import type { ImportWarning } from './parse_outline'

describe('ELD warnings stored on the unit (R5, D-028)', () => {
  const { pool, db } = connectTestDb()
  let unitId: string

  beforeAll(async () => {
    await runMigrations(pool)
    await loadStandards(db, STANDARDS_DIR)
  })
  afterAll(async () => {
    // Integration files share one database; leave no units, imports or standards behind.
    await db.delete(units)
    await db.delete(pendingImports)
    await db.delete(standards)
    await pool.end()
  })
  beforeEach(async () => {
    await db.delete(units)
    const preview = await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() }, {})
    unitId = (await confirmImport(db, preview.importId, {})).unitId
  })

  it('has no ELD warnings before a file is attached', async () => {
    expect(await getUnitEldWarnings(db, unitId)).toEqual([])
  })

  it('matches the sample ELD rows by lesson number and stores the unmatched ones', async () => {
    const result = await attachEldFile(db, unitId, sampleEldCsv())

    // Spark (3) and Investigation 1 (16) rows match lessons 1-19 by number.
    expect(result.matched).toBeGreaterThanOrEqual(19)
    const stored = await getUnitEldWarnings(db, unitId)
    expect(stored).toEqual(result.warnings)
    const text = stored.map((warning: ImportWarning) => warning.message).join('\n')
    expect(text).toContain('L45_DELD_TE_G8_U4_CA_Core')
    expect(text).not.toContain('L4_DELD_TE_G8_U4_CA_Core')
    expect(text).not.toContain('L19_DELD_TE_G8_U4_CA_Core')
  })

  it('replaces the stored warnings when another ELD file is attached', async () => {
    await attachEldFile(db, unitId, sampleEldCsv())
    await attachEldFile(db, unitId, filledEldCsv())

    const text = (await getUnitEldWarnings(db, unitId))
      .map((w: ImportWarning) => w.message)
      .join('\n')
    expect(await getUnitEldWarnings(db, unitId)).toHaveLength(3)
    expect(text).toContain('L19B_DELD_TE_G6_U4_CA_Core')
    expect(text).not.toContain('L45_DELD_TE_G8_U4_CA_Core')
  })

  it('returns no warnings for a unit that does not exist', async () => {
    expect(await getUnitEldWarnings(db, '00000000-0000-4000-8000-000000000000')).toEqual([])
  })
})
