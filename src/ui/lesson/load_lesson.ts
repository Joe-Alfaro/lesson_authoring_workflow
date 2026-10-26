// Server-side data for the lesson editor and lesson view pages.
import { eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '../../db/client'
import { lessons, standards, units, users, type LessonStatus } from '../../db/schema'
import type { StandardRef } from '../../editor/standards'
import { getLessonGeneration } from '../../generation/service'
import { isUuid } from '../../import/is_uuid'
import { LessonContent } from '../../lesson/schema'
import { getLessonHistory } from '../../workflow/service'

export interface LessonPageData {
  id: string
  unitId: string
  unitNumber: number
  /** The unit's grade ("Simplify for grade 6", R20). */
  grade: number
  number: number | null
  status: LessonStatus
  /** Null until the lesson is generated (or when stored content no longer validates). */
  content: LessonContent | null
  assignee: { id: string; name: string } | null
  /** "Prompt v3, Haiku-class" when generated content exists. */
  provenance: string | null
  /** Who approved it and when, for the lock notice (R23). */
  approval: { name: string; at: string } | null
}

/** "claude-haiku-5-5" -> "Haiku-class". */
export function modelClass(model: string): string {
  const family = /claude-([a-z]+)/i.exec(model)?.[1] ?? model
  return `${family.charAt(0).toUpperCase()}${family.slice(1)}-class`
}

export async function loadLessonPage(
  db: Database,
  lessonId: string,
): Promise<LessonPageData | null> {
  if (!isUuid(lessonId)) return null
  const assignee = alias(users, 'assignee')
  const [row] = await db
    .select({
      id: lessons.id,
      unitId: lessons.unitId,
      unitNumber: units.unitNumber,
      grade: units.grade,
      number: lessons.lessonNumber,
      status: lessons.status,
      content: lessons.content,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
    })
    .from(lessons)
    .innerJoin(units, eq(units.id, lessons.unitId))
    .leftJoin(assignee, eq(assignee.id, lessons.assigneeId))
    .where(eq(lessons.id, lessonId))
  if (!row) return null

  const [generation, history] = await Promise.all([
    getLessonGeneration(db, lessonId),
    getLessonHistory(db, lessonId),
  ])
  const approved = [...history].reverse().find((event) => event.toStatus === 'approved')
  const parsed = LessonContent.safeParse(row.content)

  return {
    id: row.id,
    unitId: row.unitId,
    unitNumber: row.unitNumber,
    grade: row.grade,
    number: row.number,
    status: row.status,
    content: parsed.success ? parsed.data : null,
    assignee:
      row.assigneeId && row.assigneeName ? { id: row.assigneeId, name: row.assigneeName } : null,
    provenance: generation
      ? `Prompt v${generation.promptVersion}, ${modelClass(generation.model)}`
      : null,
    approval:
      row.status === 'approved' && approved?.actor
        ? { name: approved.actor.name, at: approved.at.toISOString() }
        : null,
  }
}

/** Reference standards (R15); all of them, or only the given codes. */
export async function loadStandards(db: Database, codes?: string[]): Promise<StandardRef[]> {
  if (codes && codes.length === 0) return []
  const query = db
    .select({
      code: standards.code,
      framework: standards.framework,
      strand: standards.strand,
      text: standards.text,
    })
    .from(standards)
  const rows = codes ? await query.where(inArray(standards.code, codes)) : await query
  return rows.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
}

/** Every standard code a lesson mentions (front matter, parts, blocks). */
export function lessonCodes(content: LessonContent): string[] {
  const codes = new Set<string>([
    ...content.frontMatter.focusStandards,
    ...content.frontMatter.supportingStandards,
    ...content.frontMatter.eldStandards.map((eld) => eld.code),
  ])
  content.body.sections.forEach((section) =>
    section.parts.forEach((part) => part.standards.forEach((code) => codes.add(code))),
  )
  return [...codes]
}
