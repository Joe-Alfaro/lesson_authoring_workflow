// R16: download file names are safe whatever the outline or the lesson title holds.
// Contract: src/export/README.md (File names).
import { describe, expect, it } from 'vitest'
import { lessonFileName, unitFileName } from './file_names'

const SAFE = /^[a-z0-9][a-z0-9-]*\.(json|html)$/
const HOSTILE = '../../etc/passwd "x"\r\nSet-Cookie: a=b <script>é/\\;:*?|%00'

describe('lessonFileName', () => {
  it('names a lesson by unit and number, with the extension asked for', () => {
    const input = {
      unitNumber: 4,
      lessonNumber: 4,
      position: 5,
      title: 'Placeholder Lesson: Claims and Details',
    }
    const json = lessonFileName(input, 'json')
    const html = lessonFileName(input, 'html')
    expect(json).toMatch(/^unit-4-lesson-4(-[a-z0-9-]+)?\.json$/)
    expect(html).toMatch(/^unit-4-lesson-4(-[a-z0-9-]+)?\.html$/)
    expect(json.replace(/\.json$/, '')).toBe(html.replace(/\.html$/, ''))
  })

  it('names flex days by position, so two flex days never collide', () => {
    const first = lessonFileName(
      { unitNumber: 4, lessonNumber: null, position: 7, title: 'Flex' },
      'json',
    )
    const second = lessonFileName(
      { unitNumber: 4, lessonNumber: null, position: 19, title: 'Flex' },
      'json',
    )
    expect(first).toMatch(/^unit-4-flex-day-7(-[a-z0-9-]+)?\.json$/)
    expect(second).toMatch(/^unit-4-flex-day-19(-[a-z0-9-]+)?\.json$/)
    expect(first).not.toBe(second)
  })

  it('keeps only lowercase ASCII letters, digits and hyphens from a hostile title', () => {
    for (const ext of ['json', 'html'] as const) {
      const name = lessonFileName(
        { unitNumber: 4, lessonNumber: 12, position: 13, title: HOSTILE },
        ext,
      )
      expect(name).toMatch(SAFE)
      expect(name.endsWith(`.${ext}`)).toBe(true)
      expect(name).not.toMatch(/\.\.|--/)
      expect(name.length).toBeLessThanOrEqual(100)
    }
  })

  it('stays at most 100 characters for a very long title', () => {
    const name = lessonFileName(
      { unitNumber: 4, lessonNumber: 40, position: 45, title: 'word '.repeat(80) },
      'html',
    )
    expect(name).toMatch(SAFE)
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.startsWith('unit-4-lesson-40')).toBe(true)
  })
})

describe('unitFileName', () => {
  it('names a unit by grade and number', () => {
    const name = unitFileName(
      { grade: 6, unitNumber: 4, anchorTextTitle: 'Placeholder Anchor Novel' },
      'json',
    )
    expect(name).toMatch(/^grade-6-unit-4(-[a-z0-9-]+)?\.json$/)
    expect(
      unitFileName(
        { grade: 6, unitNumber: 4, anchorTextTitle: 'Placeholder Anchor Novel' },
        'html',
      ),
    ).toMatch(/^grade-6-unit-4(-[a-z0-9-]+)?\.html$/)
  })

  it('keeps a hostile anchor title out of the name', () => {
    const name = unitFileName({ grade: 6, unitNumber: 4, anchorTextTitle: HOSTILE }, 'html')
    expect(name).toMatch(SAFE)
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.startsWith('grade-6-unit-4')).toBe(true)
  })
})
