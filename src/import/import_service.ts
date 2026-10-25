import { eq, lt, sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import {
  arcs,
  lessonStandards,
  lessons,
  pendingImports,
  standards,
  units,
  type PendingImportPayload,
} from '../db/schema'
import { isUuid } from './is_uuid'
import { matchEldRows, parseEldFile, type EldRow } from './parse_eld'
import { normalizeStandards, type StandardKind } from './normalize_standards'
import {
  parseOutline,
  type ImportWarning,
  type ParsedItem,
  type ParsedOutline,
} from './parse_outline'
import { fetchSheetCsv, type FetchLike } from './sheet_link'

export type { ImportWarning }

export class ImportNotFoundError extends Error {
  constructor(importId: string) {
    super(`Import ${importId} does not exist, or it was already confirmed or cancelled.`)
    this.name = 'ImportNotFoundError'
  }
}

export type ImportSource = { kind: 'csv'; csv: string } | { kind: 'sheet'; url: string }

export interface PreviewItem {
  position: number
  lessonNumber: number | null
  arcName: string
  lessonType: string
  /** First line of the description. */
  title: string
  /** The first page range in the description ("pp. 1–8"), or null. */
  pages: string | null
  description: string
  focusStandards: string[]
  /** The focus standards cell as written, so the UI can show what was normalized (R3). */
  focusStandardsText: string
  warnings: ImportWarning[]
}

/** R5: what an ELD file attached to the import adds, shown on the preview. */
export interface EldPreview {
  rows: number
  /** Rows with at least one non-empty content field. */
  rowsWithContent: number
  matched: number
  /** Filenames of the rows that matched no lesson, in file order. */
  unmatchedRows: string[]
  warnings: ImportWarning[]
}

export interface ImportPreview {
  importId: string
  unit: ParsedOutline['unit']
  arcs: { name: string; description: string }[]
  lessons: PreviewItem[]
  flexDays: PreviewItem[]
  warnings: ImportWarning[]
  eld: EldPreview | null
}

// Pending imports nobody confirmed or cancelled are dropped after this long.
const PENDING_TTL = '1 day'

const COLUMN_KINDS: [keyof ParsedItem & `${string}Standards`, StandardKind][] = [
  ['focusStandards', 'focus'],
  ['supportingStandards', 'supporting'],
  ['mediaLiteracyStandards', 'media'],
  ['eldStandards', 'eld'],
]

function itemLabel(item: ParsedItem): string {
  return item.isFlex ? `Flex day (${item.arcName})` : `Lesson ${item.lessonNumber}`
}

/** Normalizes every standards cell; one warning per unknown code per item (R3). */
function normalizeItem(
  item: ParsedItem,
  grade: number,
  isKnown: (code: string) => boolean,
): PendingImportPayload['standards'][number] {
  const unknownKinds = new Map<string, StandardKind[]>()
  const codes = Object.fromEntries(
    COLUMN_KINDS.map(([field, kind]) => {
      const result = normalizeStandards(item[field], { kind, grade, isKnown })
      result.unknownCodes.forEach((code) => {
        unknownKinds.set(code, [...(unknownKinds.get(code) ?? []), kind])
      })
      return [kind, result.codes]
    }),
  ) as Record<StandardKind, string[]>
  const warnings = [...unknownKinds].map(([code, kinds]) => ({
    message:
      `${itemLabel(item)}: standard ${code} (${kinds.join(', ')}) is not in the grade ${grade} ` +
      'reference data. It is kept; check the outline.',
    lessonNumber: item.lessonNumber,
    code,
  }))
  return { codes, warnings }
}

async function loadKnownCodes(db: Database): Promise<Set<string>> {
  const rows = await db.select({ code: standards.code }).from(standards)
  return new Set(rows.map((row) => row.code))
}

const PAGE_RANGE = /\bpp?\.\s*\d+(?:\s*[–-]\s*\d+)?/

function toEldPreview(rows: EldRow[], items: ParsedItem[]): EldPreview {
  const { matches, warnings, unmatched } = matchEldRows(rows, items)
  return {
    rows: rows.length,
    rowsWithContent: rows.filter((row) => Object.keys(row.fields).length > 0).length,
    matched: matches.length,
    unmatchedRows: unmatched.map((row) => row.filename || '(no filename)'),
    warnings,
  }
}

function toPreview(importId: string, payload: PendingImportPayload): ImportPreview {
  const { outline } = payload
  const previewItems = outline.items.map((item, index) => {
    const normalized = payload.standards[index]!
    return {
      isFlex: item.isFlex,
      preview: {
        position: item.position,
        lessonNumber: item.lessonNumber,
        arcName: item.arcName,
        lessonType: item.lessonType,
        title: item.description.split('\n')[0]!.trim(),
        pages: item.description.match(PAGE_RANGE)?.[0] ?? null,
        description: item.description,
        focusStandards: normalized.codes.focus,
        focusStandardsText: item.focusStandards,
        warnings: normalized.warnings,
      },
    }
  })
  return {
    importId,
    unit: outline.unit,
    arcs: outline.arcs.map(({ name, description }) => ({ name, description })),
    lessons: previewItems.filter((entry) => !entry.isFlex).map((entry) => entry.preview),
    flexDays: previewItems.filter((entry) => entry.isFlex).map((entry) => entry.preview),
    warnings: [...outline.warnings, ...payload.standards.flatMap((entry) => entry.warnings)],
    eld: payload.eld ? toEldPreview(payload.eld.rows, outline.items) : null,
  }
}

async function readSource(source: ImportSource, fetchImpl?: FetchLike): Promise<string> {
  if (source.kind === 'csv') {
    return source.csv
  }
  return fetchSheetCsv(source.url, fetchImpl)
}

/**
 * Step 1 of R4: parses and normalizes an outline and keeps it as a pending import. Creates no
 * unit; parse and sheet errors reject before anything is stored. An optional ELD file (R5) is
 * parsed now, previewed, and attached to the unit on confirm.
 */
export async function previewImport(
  db: Database,
  source: ImportSource,
  options: { userId?: string; fetch?: FetchLike; eldCsv?: string } = {},
): Promise<ImportPreview> {
  const eldRows = options.eldCsv === undefined ? undefined : parseEldFile(options.eldCsv)
  const outline = parseOutline(await readSource(source, options.fetch))
  const known = await loadKnownCodes(db)
  const isKnown = (code: string) => known.has(code)
  const payload: PendingImportPayload = {
    outline,
    standards: outline.items.map((item) => normalizeItem(item, outline.unit.grade, isKnown)),
    ...(eldRows ? { eld: { rows: eldRows } } : {}),
  }

  await db
    .delete(pendingImports)
    .where(lt(pendingImports.createdAt, sql`now() - ${PENDING_TTL}::interval`))
  const [row] = await db
    .insert(pendingImports)
    .values({ createdBy: options.userId ?? null, payload })
    .returning({ id: pendingImports.id })
  return toPreview(row!.id, payload)
}

/**
 * Step 2 of R4: writes the unit, arcs, lessons (flex days included) and their standards in one
 * transaction and drops the pending import, so an import can be confirmed only once.
 */
export async function confirmImport(
  db: Database,
  importId: string,
  options: { userId?: string } = {},
): Promise<{ unitId: string }> {
  if (!isUuid(importId)) {
    throw new ImportNotFoundError(importId)
  }
  return db.transaction(async (tx) => {
    // Deleting first claims the import: a concurrent confirm waits on the row lock, then finds
    // nothing.
    const [pending] = await tx
      .delete(pendingImports)
      .where(eq(pendingImports.id, importId))
      .returning()
    if (!pending) {
      throw new ImportNotFoundError(importId)
    }
    const { outline, standards: normalized, eld } = pending.payload
    const eldMatch = eld ? matchEldRows(eld.rows, outline.items) : null
    const eldByPosition = new Map(
      (eldMatch?.matches ?? [])
        .filter((match) => Object.keys(match.fields).length > 0)
        .map((match) => [match.position, match.fields]),
    )

    const [unit] = await tx
      .insert(units)
      .values({
        ...outline.unit,
        eldWarnings: eldMatch?.warnings ?? [],
        createdBy: options.userId ?? pending.createdBy,
      })
      .returning({ id: units.id })
    const unitId = unit!.id

    const arcRows = await tx
      .insert(arcs)
      .values(outline.arcs.map((arc) => ({ ...arc, unitId })))
      .returning({ id: arcs.id, name: arcs.name })
    const arcIdByName = new Map(arcRows.map((arc) => [arc.name, arc.id]))

    const lessonRows = await tx
      .insert(lessons)
      .values(
        outline.items.map(({ arcName, ...item }, index) => ({
          ...item,
          unitId,
          arcId: arcIdByName.get(arcName) ?? null,
          importWarnings: normalized[index]!.warnings,
          eldInput: eldByPosition.get(item.position) ?? null,
        })),
      )
      .returning({ id: lessons.id, position: lessons.position })
    const lessonIdByPosition = new Map(lessonRows.map((row) => [row.position, row.id]))

    const standardRows = outline.items.flatMap((item, index) => {
      const lessonId = lessonIdByPosition.get(item.position)!
      return Object.entries(normalized[index]!.codes).flatMap(([kind, codes]) =>
        codes.map((code, position) => ({
          lessonId,
          code,
          kind: kind as StandardKind,
          position: position + 1,
        })),
      )
    })
    if (standardRows.length > 0) {
      await tx.insert(lessonStandards).values(standardRows)
    }
    return { unitId }
  })
}

/** R4: the author cancels from the preview; nothing was created, so only the pending row goes. */
export async function cancelImport(db: Database, importId: string): Promise<void> {
  if (!isUuid(importId)) {
    return
  }
  await db.delete(pendingImports).where(eq(pendingImports.id, importId))
}

/** R3: the import warnings (unknown standard codes) kept on a lesson. */
export async function getLessonWarnings(db: Database, lessonId: string): Promise<ImportWarning[]> {
  const [row] = await db
    .select({ warnings: lessons.importWarnings })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
  return row?.warnings ?? []
}
