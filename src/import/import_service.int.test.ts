// R1, R3, R4: two-step import (preview -> confirm or cancel) against a real Postgres.
// Contract: src/import/README.md.
import { and, asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { STANDARDS_DIR, sampleOutlineCsv } from '../../tests/import_fixtures'
import { runMigrations } from '../db/migrate'
import { arcs, lessonStandards, lessons, units, users } from '../db/schema'
import { loadStandards } from '../db/seed/standards'
import {
  ImportNotFoundError,
  cancelImport,
  confirmImport,
  getLessonWarnings,
  previewImport,
} from './import_service'
import { OutlineParseError } from './parse_outline'
import { SheetAccessError } from './sheet_link'

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1AbC-dEf_123456789xyz/edit?usp=sharing'
const NOT_SHARED = /must be shared.*anyone with the link/i

function csvFetch(body = sampleOutlineCsv()) {
  return vi.fn(
    async () => new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } }),
  ) as unknown as typeof fetch
}

describe('import service', () => {
  const { pool, db } = connectTestDb()
  let authorId: string

  beforeAll(async () => {
    await runMigrations(pool)
    await loadStandards(db, STANDARDS_DIR)
    const [author] = await db
      .insert(users)
      .values({
        email: 'import-author@example.com',
        name: 'Import Author',
        role: 'author',
        passwordHash: 'x',
      })
      .onConflictDoUpdate({ target: users.email, set: { name: 'Import Author' } })
      .returning({ id: users.id })
    authorId = author!.id
  })
  afterAll(() => pool.end())
  beforeEach(async () => {
    await db.delete(units)
  })

  async function unitCount() {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(units)
    return row?.count ?? 0
  }

  async function lessonId(unitId: string, lessonNumber: number) {
    const [row] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(eq(lessons.unitId, unitId), eq(lessons.lessonNumber, lessonNumber)))
    return row!.id
  }

  async function codesOf(id: string, kind: 'focus' | 'supporting' | 'media' | 'eld') {
    const rows = await db
      .select({ code: lessonStandards.code })
      .from(lessonStandards)
      .where(and(eq(lessonStandards.lessonId, id), eq(lessonStandards.kind, kind)))
      .orderBy(asc(lessonStandards.position))
    return rows.map((row) => row.code)
  }

  /** Lessons of a unit without ids and timestamps, for comparing two imports. */
  async function lessonSnapshot(unitId: string) {
    const rows = await db
      .select({ lesson: lessons, arcName: arcs.name })
      .from(lessons)
      .leftJoin(arcs, eq(arcs.id, lessons.arcId))
      .where(eq(lessons.unitId, unitId))
      .orderBy(asc(lessons.position))
    return Promise.all(
      rows.map(async ({ lesson, arcName }) => {
        const rest: Partial<typeof lesson> = { ...lesson }
        for (const key of ['id', 'unitId', 'arcId', 'createdAt', 'updatedAt'] as const) {
          delete rest[key]
        }
        const id = lesson.id
        return {
          ...rest,
          arcName,
          focus: await codesOf(id, 'focus'),
          eld: await codesOf(id, 'eld'),
        }
      }),
    )
  }

  describe('previewImport (R4)', () => {
    it('lists every lesson with arc, type, title and focus standards, and creates no unit', async () => {
      const preview = await previewImport(
        db,
        { kind: 'csv', csv: sampleOutlineCsv() },
        { userId: authorId },
      )

      expect(preview.importId).toEqual(expect.any(String))
      expect(preview.unit).toMatchObject({ grade: 6, unitNumber: 4, isbn: '9780786838653' })
      expect(preview.arcs.map((arc) => arc.name)).toEqual([
        'Spark',
        'Investigation 1',
        'Investigation 2',
        'Showcase',
      ])
      expect(preview.lessons.map((row) => row.lessonNumber)).toEqual(
        Array.from({ length: 41 }, (_, i) => i + 1),
      )
      expect(preview.flexDays).toHaveLength(6)
      expect(preview.lessons[0]).toMatchObject({
        lessonNumber: 1,
        arcName: 'Spark',
        lessonType: 'Spark 1',
        title: 'What Are Myths?',
        focusStandards: ['L.6.4.b', 'RI.6.1', 'RI.6.4', 'SL.6.1.a'],
        warnings: [],
      })
      expect(preview.lessons[3]).toMatchObject({
        lessonNumber: 4,
        arcName: 'Investigation 1',
        lessonType: 'Core Reading',
        title: 'Chapter 1',
        focusStandards: ['RL.6.1', 'RL.6.2', 'L.6.4'],
      })
      expect(await unitCount()).toBe(0)
    })

    it('shows unknown standard codes as warnings on the preview and on the lesson row (R3)', async () => {
      const preview = await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() }, {})

      const unknown = preview.warnings.filter((warning) => warning.code !== undefined)
      expect(new Set(unknown.map((warning) => warning.code))).toEqual(new Set(['RL.6.9.a']))
      expect(new Set(unknown.map((warning) => warning.lessonNumber))).toEqual(new Set([22, 26, 31]))
      for (const warning of unknown) {
        expect(warning.message).toContain('RL.6.9.a')
      }

      const lesson22 = preview.lessons.find((row) => row.lessonNumber === 22)!
      expect(lesson22.focusStandards).toContain('RL.6.9.a')
      // RL.6.9.a is in both the focus and the supporting cell; one or two warnings are fine.
      expect(lesson22.warnings.length).toBeGreaterThan(0)
      expect(lesson22.warnings.every((warning) => warning.code === 'RL.6.9.a')).toBe(true)
    })

    it('gives the same preview for a sheet link as for the uploaded file (R1)', async () => {
      const fetchStub = csvFetch()
      const fromFile = await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() }, {})
      const fromLink = await previewImport(
        db,
        { kind: 'sheet', url: SHEET_URL },
        { fetch: fetchStub },
      )

      expect(fetchStub).toHaveBeenCalledTimes(1)
      expect({ ...fromLink, importId: '' }).toEqual({ ...fromFile, importId: '' })
      expect(fromLink.importId).not.toBe(fromFile.importId)
    })

    it('rejects a private or missing sheet with a "share by link" message and creates no unit', async () => {
      const signInPage = vi.fn(
        async () =>
          new Response('<!DOCTYPE html><html><title>Sign in</title></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ) as unknown as typeof fetch
      const missing = vi.fn(
        async () => new Response('', { status: 404 }),
      ) as unknown as typeof fetch

      for (const fetchStub of [signInPage, missing]) {
        const error = await previewImport(
          db,
          { kind: 'sheet', url: SHEET_URL },
          { fetch: fetchStub },
        ).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(SheetAccessError)
        expect((error as Error).message).toMatch(NOT_SHARED)
      }
      expect(await unitCount()).toBe(0)
    })

    it('rejects a file that is not an outline and creates no unit', async () => {
      await expect(
        previewImport(db, { kind: 'csv', csv: 'Name,Age\nBob,3\n' }, {}),
      ).rejects.toThrow(OutlineParseError)
      expect(await unitCount()).toBe(0)
    })
  })

  describe('confirmImport (R2, R3, R4)', () => {
    it('persists the unit, arcs, lessons, flex days and standards', async () => {
      const preview = await previewImport(
        db,
        { kind: 'csv', csv: sampleOutlineCsv() },
        { userId: authorId },
      )
      const { unitId } = await confirmImport(db, preview.importId, { userId: authorId })

      const [unit] = await db.select().from(units).where(eq(units.id, unitId))
      expect(unit).toMatchObject({
        grade: 6,
        unitNumber: 4,
        anchorTextTitle: 'The Lightning Thief',
        isbn: '9780786838653',
        banner: 'G6, U4: The Lightning Thief by Rick Riordan\nISBN 9780786838653',
        createdBy: authorId,
      })

      const unitArcs = await db
        .select()
        .from(arcs)
        .where(eq(arcs.unitId, unitId))
        .orderBy(asc(arcs.position))
      expect(unitArcs.map((arc) => arc.name)).toEqual([
        'Spark',
        'Investigation 1',
        'Investigation 2',
        'Showcase',
      ])
      expect(unitArcs[0]?.description).toMatch(/^Builds knowledge related to the topic/)
      expect(unitArcs[1]?.description).toContain('Core of the unit')
      const arcName = new Map(unitArcs.map((arc) => [arc.id, arc.name]))

      const rows = await db
        .select()
        .from(lessons)
        .where(eq(lessons.unitId, unitId))
        .orderBy(asc(lessons.position))
      expect(rows).toHaveLength(47)
      const numbered = rows.filter((row) => !row.isFlex)
      const flex = rows.filter((row) => row.isFlex)
      expect(numbered.map((row) => row.lessonNumber)).toEqual(
        Array.from({ length: 41 }, (_, i) => i + 1),
      )
      expect(flex).toHaveLength(6)
      expect(flex.every((row) => row.lessonNumber === null)).toBe(true)
      expect(flex.map((row) => arcName.get(row.arcId!))).toEqual([
        'Investigation 1',
        'Investigation 1',
        'Investigation 2',
        'Investigation 2',
        'Showcase',
        'Showcase',
      ])
      expect(rows.every((row) => row.arcId !== null)).toBe(true)
      expect(numbered.every((row) => row.status === 'draft' && row.content === null)).toBe(true)

      const lesson4 = numbered[3]!
      expect(arcName.get(lesson4.arcId!)).toBe('Investigation 1')
      expect(lesson4).toMatchObject({
        filename: 'L4_ELA_TE_G6_U3_CA_Core',
        lessonType: 'Core Reading',
        days: 1,
        focusStandards: 'RL.6.1, 6.2 L.6.4',
        performanceTaskSkill: 'Identifying and explaining emerging themes',
      })
      expect(lesson4.foundationalSkills).toMatch(/^• Teacher reviews/)
      expect(Object.keys(lesson4.rawRow)).toHaveLength(16)
      expect(lesson4.rawRow['Lesson #']).toBe('Lesson 4')
      expect(numbered[38]?.filename).toBe('L309_ELA_TE_G6_U3_CA_Core')

      expect(await codesOf(lesson4.id, 'focus')).toEqual(['RL.6.1', 'RL.6.2', 'L.6.4'])
      expect(await codesOf(lesson4.id, 'eld')).toEqual(['ELD.PI.6.7', 'ELD.PI.6.6', 'ELD.PII.6.5'])
      const lesson36 = await lessonId(unitId, 36)
      expect(await codesOf(lesson36, 'media')).toEqual(['LIB.6.2.1.a', 'LIB.6.2.1.b'])
      expect(await codesOf(lesson36, 'supporting')).toEqual([
        'W.6.2.a',
        'W.6.2.b',
        'W.6.2.c',
        'W.6.2.d',
        'W.6.2.e',
        'W.6.2.f',
        'W.6.4',
        'W.6.5',
        'W.6.6',
        'W.6.8',
        'W.6.9',
        'W.6.9.a',
        'W.6.10',
      ])
      const flexStandards = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(lessonStandards)
        .where(eq(lessonStandards.lessonId, flex[0]!.id))
      expect(flexStandards[0]?.count).toBe(0)
    })

    it('stores unknown codes and keeps their warning on the lesson (R3)', async () => {
      const preview = await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() }, {})
      const { unitId } = await confirmImport(db, preview.importId, {})

      const lesson22 = await lessonId(unitId, 22)
      expect(await codesOf(lesson22, 'focus')).toEqual([
        'RL.6.9',
        'RL.6.9.a',
        'L.6.4',
        'L.6.5.a',
        'L.6.6',
      ])
      const warnings = await getLessonWarnings(db, lesson22)
      expect(warnings.length).toBeGreaterThan(0)
      for (const warning of warnings) {
        expect(warning).toMatchObject({
          code: 'RL.6.9.a',
          message: expect.stringContaining('RL.6.9.a'),
        })
      }
      expect(await getLessonWarnings(db, await lessonId(unitId, 1))).toEqual([])
    })

    it('creates the same unit from a sheet link as from the uploaded file (R1)', async () => {
      const fromFile = await confirmImport(
        db,
        (await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() }, {})).importId,
        {},
      )
      const fromLink = await confirmImport(
        db,
        (await previewImport(db, { kind: 'sheet', url: SHEET_URL }, { fetch: csvFetch() }))
          .importId,
        {},
      )

      expect(await lessonSnapshot(fromLink.unitId)).toEqual(await lessonSnapshot(fromFile.unitId))
    })

    it('can be confirmed only once', async () => {
      const preview = await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() }, {})
      await confirmImport(db, preview.importId, {})

      await expect(confirmImport(db, preview.importId, {})).rejects.toThrow(ImportNotFoundError)
      expect(await unitCount()).toBe(1)
    })

    it('rejects an unknown import id', async () => {
      await expect(confirmImport(db, '00000000-0000-4000-8000-000000000000', {})).rejects.toThrow(
        ImportNotFoundError,
      )
    })
  })

  describe('cancelImport (R4)', () => {
    it('drops the pending import so no unit remains and it cannot be confirmed', async () => {
      const preview = await previewImport(db, { kind: 'csv', csv: sampleOutlineCsv() }, {})
      await cancelImport(db, preview.importId)

      expect(await unitCount()).toBe(0)
      await expect(confirmImport(db, preview.importId, {})).rejects.toThrow(ImportNotFoundError)
      expect(await unitCount()).toBe(0)
    })
  })
})
