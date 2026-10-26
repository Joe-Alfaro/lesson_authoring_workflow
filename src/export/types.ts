// R16 export shapes: the JSON a lesson or unit downloads as, and what the HTML renders from.
// Contract: src/export/README.md.
import type { LessonStatus, StandardFramework } from '../db/schema'
import type { LessonContent } from '../lesson/schema'

export const EXPORT_VERSION = 1

export interface ExportedStandard {
  code: string
  /** Null when the code is not in the reference data (R3). */
  framework: StandardFramework | null
  strand: string | null
  text: string | null
}

export interface ExportedArc {
  id: string
  name: string
  position: number
}

export interface ExportedLesson {
  id: string
  unitId: string
  number: number | null
  isFlex: boolean
  position: number
  /** The outline's Filename cell. */
  filename: string
  /** The outline's Type of Lesson cell. */
  lessonType: string
  arc: ExportedArc | null
  status: LessonStatus
  approved: boolean
  /** The latest approve event; null when the lesson is not approved. */
  approval: { by: { id: string; name: string }; at: string } | null
  standards: ExportedStandard[]
  /** As stored, with an id on every section, part and block. */
  content: LessonContent
}

export interface ExportedUnit {
  id: string
  grade: number
  unitNumber: number
  anchorTextTitle: string
  isbn: string | null
  arcs: ExportedArc[]
}

export interface LessonExport {
  exportVersion: typeof EXPORT_VERSION
  exportedAt: string
  unit: ExportedUnit
  lesson: ExportedLesson
}

export interface SkippedLesson {
  id: string
  number: number | null
  isFlex: boolean
  status: LessonStatus
}

export interface UnitExport {
  exportVersion: typeof EXPORT_VERSION
  exportedAt: string
  unit: ExportedUnit
  /** Approved lessons with valid content, by position. */
  lessons: ExportedLesson[]
  /** Every other lesson row, by position. */
  skipped: SkippedLesson[]
  counts: { total: number; exported: number; skipped: number }
}
