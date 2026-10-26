// R16: builds the lesson and unit exports from the database. Contract: src/export/README.md.
import { and, asc, desc, eq, inArray, isNotNull, type SQL } from 'drizzle-orm'
import type { Database } from '../db/client'
import { arcs, lessons, units, users, workflowEvents } from '../db/schema'
import { isUuid } from '../import/is_uuid'
import { hasContentIds, withContentIds } from '../lesson/content_ids'
import { LessonContent } from '../lesson/schema'
import { lessonCodes, loadStandards } from '../ui/lesson/load_lesson'
import {
  EXPORT_VERSION,
  type ExportedArc,
  type ExportedLesson,
  type ExportedStandard,
  type ExportedUnit,
  type LessonExport,
  type UnitExport,
} from './types'

export type LessonExportResult =
  { ok: true; data: LessonExport } | { ok: false; reason: 'not_found' | 'no_content' }

const lessonColumns = {
  id: lessons.id,
  unitId: lessons.unitId,
  arcId: lessons.arcId,
  number: lessons.lessonNumber,
  isFlex: lessons.isFlex,
  position: lessons.position,
  filename: lessons.filename,
  lessonType: lessons.lessonType,
  status: lessons.status,
  content: lessons.content,
}

function selectLessons(db: Database, where: SQL) {
  return db.select(lessonColumns).from(lessons).where(where).orderBy(asc(lessons.position))
}

type LessonRow = Awaited<ReturnType<typeof selectLessons>>[number]

async function loadUnit(db: Database, unitId: string): Promise<ExportedUnit | null> {
  const [unit] = await db
    .select({
      id: units.id,
      grade: units.grade,
      unitNumber: units.unitNumber,
      anchorTextTitle: units.anchorTextTitle,
      isbn: units.isbn,
    })
    .from(units)
    .where(eq(units.id, unitId))
  if (!unit) return null
  const arcRows = await db
    .select({ id: arcs.id, name: arcs.name, position: arcs.position })
    .from(arcs)
    .where(eq(arcs.unitId, unitId))
    .orderBy(asc(arcs.position))
  return { ...unit, arcs: arcRows }
}

/** The stored content when it validates; ids added when a lesson still lacks them (D-051). */
function exportableContent(stored: unknown): LessonContent | null {
  const parsed = LessonContent.safeParse(stored)
  if (!parsed.success) return null
  // Stored as is, so the export is exactly what the editor and the versions hold.
  return hasContentIds(parsed.data) ? (stored as LessonContent) : withContentIds(parsed.data)
}

/** Latest approve event (with an actor) per lesson, for the lessons that are approved. */
async function loadApprovals(
  db: Database,
  lessonIds: string[],
): Promise<Map<string, ExportedLesson['approval']>> {
  if (lessonIds.length === 0) return new Map()
  const rows = await db
    .select({
      lessonId: workflowEvents.lessonId,
      at: workflowEvents.at,
      actorId: users.id,
      actorName: users.name,
    })
    .from(workflowEvents)
    .innerJoin(users, eq(users.id, workflowEvents.actorId))
    .where(
      and(
        inArray(workflowEvents.lessonId, lessonIds),
        eq(workflowEvents.toStatus, 'approved'),
        isNotNull(workflowEvents.actorId),
      ),
    )
    .orderBy(desc(workflowEvents.at))
  const approvals = new Map<string, ExportedLesson['approval']>()
  rows.forEach((row) => {
    if (approvals.has(row.lessonId)) return
    approvals.set(row.lessonId, {
      by: { id: row.actorId, name: row.actorName },
      at: row.at.toISOString(),
    })
  })
  return approvals
}

/** Every code the lessons use, with the reference text, or nulls when unknown (R3). */
async function loadStandardsFor(
  db: Database,
  contents: LessonContent[],
): Promise<(content: LessonContent) => ExportedStandard[]> {
  const codes = [...new Set(contents.flatMap(lessonCodes))]
  const reference = new Map((await loadStandards(db, codes)).map((row) => [row.code, row]))
  return (content) =>
    lessonCodes(content)
      .sort()
      .map((code) => {
        const row = reference.get(code)
        return row
          ? { code, framework: row.framework, strand: row.strand, text: row.text }
          : { code, framework: null, strand: null, text: null }
      })
}

interface Exportable {
  row: LessonRow
  content: LessonContent
}

async function exportLessons(
  db: Database,
  unit: ExportedUnit,
  exportable: Exportable[],
): Promise<ExportedLesson[]> {
  const approvedIds = exportable
    .filter(({ row }) => row.status === 'approved')
    .map(({ row }) => row.id)
  const [approvals, standardsOf] = await Promise.all([
    loadApprovals(db, approvedIds),
    loadStandardsFor(
      db,
      exportable.map(({ content }) => content),
    ),
  ])
  const arcsById = new Map<string, ExportedArc>(unit.arcs.map((arc) => [arc.id, arc]))
  return exportable.map(({ row, content }) => {
    const approved = row.status === 'approved'
    return {
      id: row.id,
      unitId: row.unitId,
      number: row.number,
      isFlex: row.isFlex,
      position: row.position,
      filename: row.filename,
      lessonType: row.lessonType,
      arc: row.arcId ? (arcsById.get(row.arcId) ?? null) : null,
      status: row.status,
      approved,
      approval: approved ? (approvals.get(row.id) ?? null) : null,
      standards: standardsOf(content),
      content,
    }
  })
}

/** One lesson, approved or not; `no_content` when it has no content that validates (409). */
export async function buildLessonExport(
  db: Database,
  lessonId: string,
  now = new Date(),
): Promise<LessonExportResult> {
  if (!isUuid(lessonId)) return { ok: false, reason: 'not_found' }
  const [row] = await selectLessons(db, eq(lessons.id, lessonId))
  if (!row) return { ok: false, reason: 'not_found' }
  const unit = await loadUnit(db, row.unitId)
  if (!unit) return { ok: false, reason: 'not_found' }
  const content = exportableContent(row.content)
  if (!content) return { ok: false, reason: 'no_content' }
  const [lesson] = await exportLessons(db, unit, [{ row, content }])
  return {
    ok: true,
    data: { exportVersion: EXPORT_VERSION, exportedAt: now.toISOString(), unit, lesson: lesson! },
  }
}

/** The unit's approved lessons with valid content, by position; null for an unknown unit. */
export async function buildUnitExport(
  db: Database,
  unitId: string,
  now = new Date(),
): Promise<UnitExport | null> {
  if (!isUuid(unitId)) return null
  const unit = await loadUnit(db, unitId)
  if (!unit) return null
  const rows = await selectLessons(db, eq(lessons.unitId, unitId))

  const exportable: Exportable[] = []
  const skipped: UnitExport['skipped'] = []
  rows.forEach((row) => {
    const content = row.status === 'approved' ? exportableContent(row.content) : null
    if (content) {
      exportable.push({ row, content })
      return
    }
    skipped.push({ id: row.id, number: row.number, isFlex: row.isFlex, status: row.status })
  })
  const exported = await exportLessons(db, unit, exportable)
  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    unit,
    lessons: exported,
    skipped,
    counts: { total: rows.length, exported: exported.length, skipped: skipped.length },
  }
}
