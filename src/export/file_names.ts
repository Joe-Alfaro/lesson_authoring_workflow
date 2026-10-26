// Download file names (R16): lowercase ASCII, digits and hyphens only, at most 100 characters, so
// nothing from an outline or a lesson title can reach the content-disposition header as is.

export type ExportExtension = 'json' | 'html'

const MAX_LENGTH = 100

/** "Placeholder Lesson: Claims" -> "placeholder-lesson-claims"; accents lose their marks. */
function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `<prefix>-<title slug>.<ext>`, the slug cut so the whole name fits in 100 characters. */
function fileName(prefix: string, title: string, ext: ExportExtension): string {
  const room = MAX_LENGTH - prefix.length - ext.length - 2
  const titleSlug = slug(title).slice(0, Math.max(room, 0)).replace(/-+$/, '')
  return `${titleSlug ? `${prefix}-${titleSlug}` : prefix}.${ext}`
}

export interface LessonFileNameInput {
  unitNumber: number
  /** Null for a flex day, which is then named by its outline position. */
  lessonNumber: number | null
  position: number
  title: string
}

export function lessonFileName(input: LessonFileNameInput, ext: ExportExtension): string {
  const lesson =
    input.lessonNumber === null ? `flex-day-${input.position}` : `lesson-${input.lessonNumber}`
  return fileName(`unit-${input.unitNumber}-${lesson}`, input.title, ext)
}

export interface UnitFileNameInput {
  grade: number
  unitNumber: number
  anchorTextTitle: string
}

export function unitFileName(input: UnitFileNameInput, ext: ExportExtension): string {
  return fileName(`grade-${input.grade}-unit-${input.unitNumber}`, input.anchorTextTitle, ext)
}
