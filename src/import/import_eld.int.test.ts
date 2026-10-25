// R4, R5: an ELD file sent with the import is previewed, then attached when the unit is created.
// Contract: src/import/README.md.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { EldSheetError, confirmImport, previewImport } from './import_service'
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

  describe('from a sheet link (R1, R5)', () => {
    const ELD_URL = 'https://docs.google.com/spreadsheets/d/1Eld-sheet_123456789xyz/edit#gid=42'
    const ELD_EXPORT =
      'https://docs.google.com/spreadsheets/d/1Eld-sheet_123456789xyz/export?format=csv&gid=42'

    function fetchReturning(response: () => Response) {
      return vi.fn(async () => response()) as unknown as typeof fetch
    }

    it('fetches the ELD tab from its link and previews it like an uploaded file', async () => {
      const fetchStub = fetchReturning(
        () => new Response(sampleEldCsv(), { headers: { 'content-type': 'text/csv' } }),
      )
      const fromLink = await previewImport(
        db,
        { kind: 'csv', csv: sampleOutlineCsv() },
        { eldUrl: ELD_URL, fetch: fetchStub },
      )
      const fromFile = await previewImport(
        db,
        { kind: 'csv', csv: sampleOutlineCsv() },
        { eldCsv: sampleEldCsv() },
      )

      expect(fetchStub).toHaveBeenCalledTimes(1)
      expect(String(vi.mocked(fetchStub).mock.calls[0]?.[0])).toBe(ELD_EXPORT)
      expect(fromLink.eld).toEqual(fromFile.eld)
    })

    it('rejects an ELD link that is not shared, says so, and stores nothing', async () => {
      const signInPage = fetchReturning(
        () =>
          new Response('<!DOCTYPE html><html><title>Sign in</title></html>', {
            headers: { 'content-type': 'text/html' },
          }),
      )
      const error = await previewImport(
        db,
        { kind: 'csv', csv: sampleOutlineCsv() },
        { eldUrl: ELD_URL, fetch: signInPage },
      ).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(EldSheetError)
      expect((error as EldSheetError).notShared).toBe(true)
      expect((error as Error).message).toMatch(/must be shared.*anyone with the link/i)
      expect(await db.select().from(pendingImports)).toHaveLength(0)
    })

    it('rejects an ELD link that is not a Google Sheets link', async () => {
      const fetchStub = fetchReturning(() => new Response(''))
      const error = await previewImport(
        db,
        { kind: 'csv', csv: sampleOutlineCsv() },
        { eldUrl: 'https://example.com/eld.csv', fetch: fetchStub },
      ).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(EldSheetError)
      expect((error as EldSheetError).notShared).toBe(false)
      expect(fetchStub).not.toHaveBeenCalled()
    })
  })
})
