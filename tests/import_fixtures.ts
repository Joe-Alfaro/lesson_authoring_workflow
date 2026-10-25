import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

export const STANDARDS_DIR = resolve(ROOT, 'data/standards')

/** The scrubbed sample outline (the "Lesson Outline" tab exported as CSV). */
export function sampleOutlineCsv(): string {
  return readFileSync(resolve(ROOT, 'data/sample_unit/lesson_outline.csv'), 'utf8')
}

/** The sample ELD tab: only Filename, Arc and Lesson Type are filled. */
export function sampleEldCsv(): string {
  return readFileSync(resolve(ROOT, 'data/sample_unit/eld_scope_and_sequence.csv'), 'utf8')
}

/** A small ELD file with content, written for R5 (see tests/fixtures/import/README.md). */
export function filledEldCsv(): string {
  return readFileSync(resolve(ROOT, 'tests/fixtures/import/eld_filled.csv'), 'utf8')
}

/** Every code in data/standards/*.json, for `isKnown` in unit tests. */
export function knownStandardCodes(): Set<string> {
  const files = ['ccss_ela_grade6.json', 'ca_eld_grade6.json', 'ca_school_library_grade6.json']
  const codes = files.flatMap((name) => {
    const records = JSON.parse(readFileSync(resolve(STANDARDS_DIR, name), 'utf8')) as Array<{
      code: string
    }>
    return records.map((record) => record.code)
  })
  return new Set(codes)
}

/** The 16 header cells of the sample outline, exactly as written. */
export const OUTLINE_HEADERS = [
  'Filename',
  'Lesson',
  'Lesson #',
  'Type of Lesson',
  'Days',
  'Text Dependent Question tied to the EQ',
  'Lesson Description',
  'Text Set Choice',
  'Homework',
  'Focus Standards (assessed)',
  'Additional Supported CA ELA Standards',
  'CA Media Literacy Standards',
  'Skill or content that will be needed for Performance Task',
  'Foundational Skills Focus',
  'Vocabulary',
  'Designated ELD Standards',
] as const
