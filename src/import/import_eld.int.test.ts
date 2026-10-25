// R4, R5: an ELD file sent with the import is previewed, then attached when the unit is created.
// Contract: src/import/README.md.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import {
  STANDARDS_DIR,
  filledEldCsv,
  sampleEldCsv,
  sampleOutlineCsv,
} from '../../tests/import_fixtures'
import { runMigrations } from '../db/migrate'
import { lessons, pendingImports, standards, units } from '../db/schema'
import { loadStandards } from '../db/seed/standards'
import { attachEldFile, getUnitEldWarnings } from './eld_service'
import { confirmImport, previewImport } from './import_service'
import { EldParseError } from './parse_eld'

describe('an ELD file sent with the import (R5)', () => {
  const { pool, db } = connectTestDb()

  beforeAll(async () => {
    await runMigrations(pool)
    await loadStandards(db, STANDARDS_DIR)
  })
  afterAll(async () => {
    await db.delete(units)
    await db.delete(pendingImports)
    await db.delete(standards)
    await pool.end()
  })
  beforeEach(async () => {
    await db.delete(units)
    await db.delete(pendingImports)
  })

  it('has no ELD summary without a file', async () => {
    const preview = await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() })
    expect(preview.eld).toBeNull()
  })

  it('summarizes the sample ELD file on the preview', async () => {
    const preview = await previewImport(
      db,
      { kind: 'csv', csv: sampleOutlineCsv() },
      { eldCsv: sampleEldCsv() },
    )
    expect(preview.eld).toMatchObject({ rows: 45, rowsWithContent: 0 })
    expect(preview.eld?.unmatchedRows).toContain('L45_DELD_TE_G8_U4_CA_Core')
    expect(preview.eld?.unmatchedRows).not.toContain('L4_DELD_TE_G8_U4_CA_Core')
    expect(preview.eld?.warnings).toHaveLength(preview.eld?.unmatchedRows.length ?? -1)
    expect(await db.select().from(units)).toHaveLength(0)
  })

  it('stores what attachEldFile would when the unit is created', async () => {
    const preview = await previewImport(
      db,
      { kind: 'csv', csv: sampleOutlineCsv() },
      { eldCsv: filledEldCsv() },
    )
    const { unitId } = await confirmImport(db, preview.importId)
    const stored = await db
      .select({ position: lessons.position, eldInput: lessons.eldInput })
      .from(lessons)
      .where(eq(lessons.unitId, unitId))
    const storedWarnings = await getUnitEldWarnings(db, unitId)

    // Attaching the same file afterwards must change nothing.
    const attached = await attachEldFile(db, unitId, filledEldCsv())
    const reattached = await db
      .select({ position: lessons.position, eldInput: lessons.eldInput })
      .from(lessons)
      .where(eq(lessons.unitId, unitId))

    expect(stored.filter((row) => row.eldInput !== null).length).toBeGreaterThan(0)
    expect(storedWarnings).toEqual(attached.warnings)
    expect(new Map(reattached.map((row) => [row.position, row.eldInput]))).toEqual(
      new Map(stored.map((row) => [row.position, row.eldInput])),
    )
  })

  it('rejects a file that is not an ELD scope and sequence and stores nothing', async () => {
    await expect(
      previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() }, { eldCsv: 'Name,Age\nBob,3\n' }),
    ).rejects.toThrow(EldParseError)
    expect(await db.select().from(pendingImports)).toHaveLength(0)
  })
})
