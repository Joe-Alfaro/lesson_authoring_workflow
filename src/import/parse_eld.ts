import { cleanCell, parseCsv } from './csv'
import type { ImportWarning, ParsedItem } from './parse_outline'

export class EldParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EldParseError'
  }
}

/** ELD scope-and-sequence content for one lesson; generation (M2) reads the non-empty ones. */
export interface EldFields {
  eldStandards?: string
  languageObjective?: string
  contentObjective?: string
  ideasLaunch?: string
  ideasLiteracyLab?: string
  ideasLearningInAction?: string
  ideasLookBack?: string
  routines?: string
}

export interface EldRow {
  filename: string
  arc: string
  lessonType: string
  /** Only the non-empty content cells. */
  fields: EldFields
}

export interface EldMatch {
  position: number
  fields: EldFields
}

type EldItem = Pick<ParsedItem, 'position' | 'arcName' | 'lessonType'>

const CONTENT_COLUMNS: { field: keyof EldFields; header: string }[] = [
  { field: 'eldStandards', header: 'eld standards' },
  { field: 'languageObjective', header: 'language objective' },
  { field: 'contentObjective', header: 'content objective' },
  { field: 'ideasLaunch', header: 'ideas for launch' },
  { field: 'ideasLiteracyLab', header: 'ideas for literacy lab' },
  { field: 'ideasLearningInAction', header: 'ideas for learning in action' },
  { field: 'ideasLookBack', header: 'ideas for look back' },
  { field: 'routines', header: 'suggested routines' },
]

function normalizeHeader(value: string): string {
  return cleanCell(value).toLowerCase().replace(/\s+/g, ' ')
}

/** Reads an ELD scope-and-sequence tab exported as CSV (R5). Blank rows are skipped. */
export function parseEldFile(csv: string): EldRow[] {
  const rows = parseCsv(csv)
  const headerIndex = rows.findIndex((row) => {
    const names = row.map(normalizeHeader)
    return names.includes('filename') && names.includes('arc') && names.includes('lesson type')
  })
  if (headerIndex < 0) {
    throw new EldParseError(
      'This is not an ELD scope and sequence: no header row with Filename, Arc and Lesson Type.',
    )
  }
  const names = rows[headerIndex]!.map(normalizeHeader)
  const at = (row: string[], header: string) => {
    const index = names.findIndex((name) => name.startsWith(header))
    return index < 0 ? '' : cleanCell(row[index])
  }

  return rows
    .slice(headerIndex + 1)
    .map((row) => ({
      filename: at(row, 'filename'),
      arc: at(row, 'arc'),
      lessonType: at(row, 'lesson type'),
      fields: Object.fromEntries(
        CONTENT_COLUMNS.map(({ field, header }) => [field, at(row, header)] as const).filter(
          ([, value]) => value !== '',
        ),
      ) as EldFields,
    }))
    .filter((row) => row.filename !== '' || row.arc !== '' || Object.keys(row.fields).length > 0)
}

function groupKey(arc: string, lessonType: string): string {
  return `${arc.trim().toLowerCase()}\u0000${lessonType.trim().toLowerCase()}`
}

/**
 * Matches ELD rows to outline items (lessons and flex days): the n-th row of an arc and lesson
 * type goes to the n-th item of that arc and type, in outline order. Unmatched rows are warnings.
 */
export function matchEldRows(
  rows: EldRow[],
  items: EldItem[],
): { matches: EldMatch[]; warnings: ImportWarning[] } {
  const itemsByGroup = new Map<string, EldItem[]>()
  ;[...items]
    .sort((a, b) => a.position - b.position)
    .forEach((item) => {
      const key = groupKey(item.arcName, item.lessonType)
      itemsByGroup.set(key, [...(itemsByGroup.get(key) ?? []), item])
    })

  const used = new Map<string, number>()
  const matches: EldMatch[] = []
  const warnings: ImportWarning[] = []
  rows.forEach((row) => {
    const key = groupKey(row.arc, row.lessonType)
    const count = used.get(key) ?? 0
    const item = itemsByGroup.get(key)?.[count]
    if (!item) {
      const name = row.filename || '(no filename)'
      warnings.push({
        message:
          `ELD row ${name} (arc "${row.arc}", lesson type "${row.lessonType}") ` +
          'matches no lesson in the outline.',
      })
      return
    }
    used.set(key, count + 1)
    matches.push({ position: item.position, fields: row.fields })
  })
  return { matches, warnings }
}
