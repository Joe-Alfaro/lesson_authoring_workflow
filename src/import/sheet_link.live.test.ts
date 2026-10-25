// R1 live check against a real "anyone with the link" sheet holding the scrubbed sample.
// Set IMPORT_TEST_SHEET_URL to run it; it is skipped otherwise (no sheet link is tracked).
import { describe, expect, it } from 'vitest'
import { parseOutline } from './parse_outline'
import { fetchSheetCsv } from './sheet_link'

const sheetUrl = process.env.IMPORT_TEST_SHEET_URL

describe.skipIf(!sheetUrl)('fetchSheetCsv against IMPORT_TEST_SHEET_URL (live)', () => {
  it('imports the sample outline without Google credentials', { timeout: 30_000 }, async () => {
    const outline = parseOutline(await fetchSheetCsv(sheetUrl!))
    const lessons = outline.items.filter((item) => !item.isFlex)

    expect(outline.unit).toMatchObject({ grade: 6, isbn: '9780786838653' })
    expect(lessons.map((item) => item.lessonNumber)).toEqual(
      Array.from({ length: 41 }, (_, i) => i + 1),
    )
    expect(outline.arcs).toHaveLength(4)
    expect(outline.items.filter((item) => item.isFlex)).toHaveLength(6)
  })
})
