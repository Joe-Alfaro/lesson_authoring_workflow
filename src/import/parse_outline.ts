import { cleanCell, parseCsv } from './csv'

export class OutlineParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutlineParseError'
  }
}

export interface ImportWarning {
  message: string
  lessonNumber?: number | null
  code?: string
}

export interface ParsedUnit {
  grade: number
  unitNumber: number
  anchorTextTitle: string
  isbn: string | null
  banner: string
}

export interface ParsedArc {
  name: string
  description: string
  position: number
}

/** Outline text fields, named like the `lessons` columns. */
export interface OutlineFields {
  filename: string
  lessonType: string
  textDependentQuestion: string
  description: string
  textSet: string
  homework: string
  focusStandards: string
  supportingStandards: string
  mediaLiteracyStandards: string
  performanceTaskSkill: string
  foundationalSkills: string
  vocabulary: string
  eldStandards: string
}

export interface ParsedItem extends OutlineFields {
  position: number
  arcName: string
  isFlex: boolean
  lessonNumber: number | null
  days: number
  rawRow: Record<string, string>
}

export interface ParsedOutline {
  unit: ParsedUnit
  arcs: ParsedArc[]
  items: ParsedItem[]
  warnings: ImportWarning[]
}

type ColumnKey = keyof OutlineFields | 'arc' | 'lessonNumber' | 'days'

// Header cells are matched case-insensitively: exact for the short ones, by prefix for the long
// ones, so a lightly reworded header ("Focus Standards" without "(assessed)") still imports.
const COLUMNS: { key: ColumnKey; header: string; exact?: boolean }[] = [
  { key: 'filename', header: 'filename', exact: true },
  { key: 'arc', header: 'lesson', exact: true },
  { key: 'lessonNumber', header: 'lesson #', exact: true },
  { key: 'lessonType', header: 'type of lesson' },
  { key: 'days', header: 'days' },
  { key: 'textDependentQuestion', header: 'text dependent question' },
  { key: 'description', header: 'lesson description' },
  { key: 'textSet', header: 'text set' },
  { key: 'homework', header: 'homework' },
  { key: 'focusStandards', header: 'focus standards' },
  { key: 'supportingStandards', header: 'additional' },
  { key: 'mediaLiteracyStandards', header: 'ca media literacy' },
  { key: 'performanceTaskSkill', header: 'skill or content' },
  { key: 'foundationalSkills', header: 'foundational skills' },
  { key: 'vocabulary', header: 'vocabulary' },
  { key: 'eldStandards', header: 'designated eld' },
]

const REQUIRED: ColumnKey[] = ['filename', 'arc', 'lessonNumber', 'lessonType', 'description']

const LESSON_NUMBER = /^lesson\s*(\d+)$/i
const FLEX_BLOCK = /^end of .*\(flex days?\)$/i

function normalizeHeader(value: string): string {
  return cleanCell(value).toLowerCase().replace(/\s+/g, ' ')
}

function findColumns(header: string[]): Map<ColumnKey, number> | null {
  const names = header.map(normalizeHeader)
  const columns = new Map<ColumnKey, number>()
  COLUMNS.forEach(({ key, header: wanted, exact }) => {
    const index = names.findIndex((name) => (exact ? name === wanted : name.startsWith(wanted)))
    if (index >= 0) {
      columns.set(key, index)
    }
  })
  return REQUIRED.every((key) => columns.has(key)) ? columns : null
}

function parseBanner(banner: string): ParsedUnit {
  const firstLine = banner.split('\n')[0] ?? ''
  const match = firstLine.match(/^G(?:rade)?\s*(\d+)\s*,\s*U(?:nit)?\s*(\d+)\s*:\s*(.+)$/i)
  if (!match) {
    throw new OutlineParseError(
      'The outline has no banner row like "G6, U4: <anchor text> by <author>" above the header.',
    )
  }
  const [, grade, unitNumber, titleAndAuthor] = match
  // The last " by " separates the author, so a title containing "by" keeps it.
  const title = titleAndAuthor!.match(/^(.*)\s+by\s+.+$/i)?.[1] ?? titleAndAuthor!
  const isbn = banner.match(/ISBN(?:-1[03])?[:\s]*(\d[\d\s-]*[\dX])/i)?.[1]
  return {
    grade: Number(grade),
    unitNumber: Number(unitNumber),
    anchorTextTitle: title.trim(),
    isbn: isbn ? isbn.replace(/[\s-]/g, '') : null,
    banner,
  }
}

/**
 * Parses the "Lesson Outline" tab exported as CSV (R2): a banner row, the 16-column header, then
 * arc header rows, lessons, "End of <arc> (Flex Days)" blocks with flex days, and a totals row.
 */
export function parseOutline(csv: string): ParsedOutline {
  const rows = parseCsv(csv)
  const headerIndex = rows.findIndex((row) => findColumns(row) !== null)
  if (headerIndex < 0) {
    throw new OutlineParseError(
      'This is not a lesson outline: no header row with Filename, Lesson, Lesson #, ' +
        'Type of Lesson and Lesson Description was found.',
    )
  }
  const header = rows[headerIndex]!.map(cleanCell)
  const columns = findColumns(header)!
  const banner = rows
    .slice(0, headerIndex)
    .flat()
    .map(cleanCell)
    .find((cell) => cell !== '')
  const unit = parseBanner(banner ?? '')

  const arcs: ParsedArc[] = []
  const items: ParsedItem[] = []
  const warnings: ImportWarning[] = []
  const rowOfLesson = new Map<number, number>()
  let currentArc: string | null = null

  function cell(row: string[], key: ColumnKey): string {
    const index = columns.get(key)
    return index === undefined ? '' : cleanCell(row[index])
  }

  function ensureArc(name: string, description = ''): void {
    const existing = arcs.find((arc) => arc.name === name)
    if (existing) {
      existing.description ||= description
      return
    }
    arcs.push({ name, description, position: arcs.length + 1 })
  }

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const sheetRow = headerIndex + offset + 2 // 1-based, as the spreadsheet shows it
    const arcCell = cell(row, 'arc')
    const filename = cell(row, 'filename')
    const lessonNumberMatch = cell(row, 'lessonNumber').match(LESSON_NUMBER)
    const isFlex = arcCell.toLowerCase() === 'flex'

    if (!lessonNumberMatch && !isFlex) {
      if (filename === '' && arcCell !== '' && !FLEX_BLOCK.test(arcCell)) {
        currentArc = arcCell
        ensureArc(arcCell, cell(row, 'description'))
      } else if (filename !== '') {
        warnings.push({
          message: `Row ${sheetRow} (${filename}) has no "Lesson N" number and was skipped.`,
        })
      }
      // "End of … (Flex Days)" rows, the totals row and blank rows create nothing.
      return
    }

    const lessonNumber = lessonNumberMatch ? Number(lessonNumberMatch[1]) : null
    if (lessonNumber !== null) {
      const previous = rowOfLesson.get(lessonNumber)
      if (previous !== undefined) {
        throw new OutlineParseError(
          `Lesson ${lessonNumber} appears twice in the outline (rows ${previous} and ${sheetRow}).`,
        )
      }
      rowOfLesson.set(lessonNumber, sheetRow)
    }

    const arcName = isFlex || arcCell === '' ? currentArc : arcCell
    if (arcName === null) {
      throw new OutlineParseError(`Row ${sheetRow} comes before any arc header row.`)
    }
    if (!isFlex) {
      currentArc = arcName
      ensureArc(arcName)
    }

    const daysText = cell(row, 'days')
    const days = daysText === '' ? 1 : Number(daysText)
    if (!Number.isFinite(days) || days <= 0) {
      throw new OutlineParseError(`Row ${sheetRow} has an invalid Days value "${daysText}".`)
    }

    items.push({
      position: items.length + 1,
      arcName,
      isFlex,
      lessonNumber,
      days,
      filename,
      lessonType: cell(row, 'lessonType'),
      textDependentQuestion: cell(row, 'textDependentQuestion'),
      description: cell(row, 'description'),
      textSet: cell(row, 'textSet'),
      homework: cell(row, 'homework'),
      focusStandards: cell(row, 'focusStandards'),
      supportingStandards: cell(row, 'supportingStandards'),
      mediaLiteracyStandards: cell(row, 'mediaLiteracyStandards'),
      performanceTaskSkill: cell(row, 'performanceTaskSkill'),
      foundationalSkills: cell(row, 'foundationalSkills'),
      vocabulary: cell(row, 'vocabulary'),
      eldStandards: cell(row, 'eldStandards'),
      rawRow: rawRowOf(header, row),
    })
  })

  if (items.length === 0) {
    throw new OutlineParseError('The outline has no lesson rows.')
  }
  return { unit, arcs, items, warnings }
}

function rawRowOf(header: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(
    header
      .map((name, index) => [name, cleanCell(row[index])] as const)
      .filter(([name]) => name !== ''),
  )
}
