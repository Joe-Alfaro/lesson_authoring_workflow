// R2: parse the sample outline. Contract: src/import/README.md.
import { describe, expect, it } from 'vitest'
import { OUTLINE_HEADERS, sampleOutlineCsv } from '../../tests/import_fixtures'
import { OutlineParseError, parseOutline, type ParsedItem } from './parse_outline'

const outline = parseOutline(sampleOutlineCsv())
const lessons = outline.items.filter((item) => !item.isFlex)
const flexDays = outline.items.filter((item) => item.isFlex)

function lesson(number: number): ParsedItem {
  const found = lessons.find((item) => item.lessonNumber === number)
  if (!found) {
    throw new Error(`lesson ${number} not parsed`)
  }
  return found
}

const TEXT_FIELDS = [
  'filename',
  'lessonType',
  'textDependentQuestion',
  'description',
  'textSet',
  'homework',
  'focusStandards',
  'supportingStandards',
  'mediaLiteracyStandards',
  'performanceTaskSkill',
  'foundationalSkills',
  'vocabulary',
  'eldStandards',
] as const

const EDGE_WHITESPACE = /^[\s ]|[\s ]$/

describe('parseOutline on the sample outline (R2)', () => {
  it('reads grade, unit, anchor text title and ISBN from the banner', () => {
    expect(outline.unit).toEqual({
      grade: 6,
      unitNumber: 4,
      anchorTextTitle: 'The Lightning Thief',
      isbn: '9780786838653',
      banner: 'G6, U4: The Lightning Thief by Rick Riordan\nISBN 9780786838653',
    })
  })

  it('yields exactly 41 lessons numbered 1-41 in outline order', () => {
    expect(lessons).toHaveLength(41)
    expect(lessons.map((item) => item.lessonNumber)).toEqual(
      Array.from({ length: 41 }, (_, i) => i + 1),
    )
  })

  it('keeps items in row order with increasing positions', () => {
    const positions = outline.items.map((item) => item.position)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('stores the 4 arcs in order with their descriptions', () => {
    expect(outline.arcs.map((arc) => arc.name)).toEqual([
      'Spark',
      'Investigation 1',
      'Investigation 2',
      'Showcase',
    ])
    const [spark, inv1, inv2, showcase] = outline.arcs
    expect(spark?.description).toBe(
      'Builds knowledge related to the topic, piques excitement, and students show what they ' +
        'already know about the unit topic and key ELA content.',
    )
    expect(inv1?.description).toContain('Core of the unit: engaging with anchor text')
    expect(inv2?.description).toContain('Continued engaging with anchor text OR further engaging')
    expect(showcase?.description).toContain('Opportunity for students to showcase their learning')
    for (const arc of outline.arcs) {
      expect(arc.description).not.toMatch(EDGE_WHITESPACE)
    }
  })

  it('links every lesson to its arc', () => {
    const arcOf = (from: number, to: number) =>
      lessons
        .filter((item) => item.lessonNumber! >= from && item.lessonNumber! <= to)
        .map((item) => item.arcName)
    expect(new Set(arcOf(1, 3))).toEqual(new Set(['Spark']))
    expect(new Set(arcOf(4, 19))).toEqual(new Set(['Investigation 1']))
    expect(new Set(arcOf(20, 35))).toEqual(new Set(['Investigation 2']))
    expect(new Set(arcOf(36, 41))).toEqual(new Set(['Showcase']))
  })

  it('stores the 6 flex days as flex days in the arc they close, without lesson numbers', () => {
    expect(flexDays).toHaveLength(6)
    expect(flexDays.map((item) => item.arcName)).toEqual([
      'Investigation 1',
      'Investigation 1',
      'Investigation 2',
      'Investigation 2',
      'Showcase',
      'Showcase',
    ])
    for (const flex of flexDays) {
      expect(flex.lessonNumber).toBeNull()
      expect(flex.lessonType).toBe('End-of-Arc Flex Day')
      expect(flex.days).toBe(1)
    }
    expect(flexDays[0]?.description).toMatch(/^Meaning-Making Huddle\n/)
    expect(flexDays[5]?.description).toMatch(/^Knowledge Boost Huddle/)
  })

  it('creates nothing for arc header rows, "End of ... (Flex Days)" rows and the totals row', () => {
    expect(outline.items).toHaveLength(47)
    for (const item of outline.items) {
      expect(item.description).not.toMatch(/^(Builds knowledge|Core of the unit|Flexible days)/)
      expect(item.arcName).not.toMatch(/^End of/)
      expect(item.rawRow.Days).not.toBe('47')
    }
  })

  it('keeps all 16 columns of a lesson', () => {
    expect(lesson(4)).toMatchObject({
      filename: 'L4_ELA_TE_G6_U3_CA_Core',
      arcName: 'Investigation 1',
      isFlex: false,
      lessonNumber: 4,
      lessonType: 'Core Reading',
      days: 1,
      textSet: '',
      focusStandards: 'RL.6.1, 6.2 L.6.4',
      supportingStandards:
        'RL.6.1, RL.6.2, RL.6.3, RL.6.4, RL.6.5, RL.6.6, RL.6.10, L.6.4, L.6.4.a, L.6.4.d, L.6.5, L.6.6',
      mediaLiteracyStandards: '',
      performanceTaskSkill: 'Identifying and explaining emerging themes',
      eldStandards:
        '• ELD.PI.6.7 – Analyze how language creates meaning\n' +
        '• ELD.PI.6.6 – Justify interpretations with evidence\n' +
        '• ELD.PII.6.5 – Use transitions to connect ideas',
    })
    expect(lesson(4).textDependentQuestion).toMatch(/^How do Percy’s comments in the opening/)
    expect(lesson(4).description).toMatch(/^Chapter 1\nFocus: pp\. 1–8/)
    expect(lesson(4).homework).toMatch(
      /^• Read and annotate The Lightning Thief Ch\. 1 \(pp\. 9–15\)/,
    )
    expect(lesson(4).foundationalSkills).toMatch(/^• Teacher reviews determining\/clarifying/)
    expect(lesson(4).vocabulary).toMatch(/^• envy \(1\)\n/)

    expect(lesson(36)).toMatchObject({
      mediaLiteracyStandards: '2.1.a, 2.1.b',
      homework: '• Finish essay outline',
      performanceTaskSkill: 'Planning Performance Task',
      vocabulary: '',
    })
    expect(lesson(1).textSet).toMatch(/^• "What Are Myths\?" client-library article/)
  })

  it('keeps every cell in rawRow, keyed by the 16 header names', () => {
    for (const item of outline.items) {
      expect(Object.keys(item.rawRow)).toEqual([...OUTLINE_HEADERS])
    }
    expect(lesson(4).rawRow).toMatchObject({
      Filename: 'L4_ELA_TE_G6_U3_CA_Core',
      Lesson: 'Investigation 1',
      'Lesson #': 'Lesson 4',
      'Type of Lesson': 'Core Reading',
      Days: '1.0',
      'Focus Standards (assessed)': 'RL.6.1, 6.2 L.6.4',
      'CA Media Literacy Standards': '',
    })
  })

  it('trims non-breaking spaces from every cell', () => {
    // Lesson 4's Foundational Skills cell starts with U+00A0; a flex day's Text Set cell is only one.
    expect(lesson(4).foundationalSkills.startsWith(' ')).toBe(false)
    expect(flexDays[2]?.textSet).toBe('')
    for (const item of outline.items) {
      for (const field of TEXT_FIELDS) {
        expect(item[field], `${field} of item ${item.position}`).not.toMatch(EDGE_WHITESPACE)
      }
      for (const [header, value] of Object.entries(item.rawRow)) {
        expect(value, `${header} of item ${item.position}`).not.toMatch(EDGE_WHITESPACE)
      }
    }
  })

  // D-028: U+00A0 inside a cell (not only at its edges) becomes a normal space.
  it('turns every non-breaking space inside a cell into a normal space', () => {
    expect(sampleOutlineCsv()).toContain('graphic organizers.\u00a0')
    expect(lesson(9).foundationalSkills).toContain('graphic organizers. ')
    for (const item of outline.items) {
      for (const field of TEXT_FIELDS) {
        expect(item[field], `${field} of item ${item.position}`).not.toContain('\u00a0')
      }
      for (const [header, value] of Object.entries(item.rawRow)) {
        expect(value, `${header} of item ${item.position}`).not.toContain('\u00a0')
      }
    }
    for (const arc of outline.arcs) {
      expect(arc.description, arc.name).not.toContain('\u00a0')
    }
    expect(outline.unit.banner).not.toContain('\u00a0')
    expect(outline.unit.anchorTextTitle).not.toContain('\u00a0')
  })

  it('takes lesson numbers from "Lesson #" and keeps filenames with typos as written', () => {
    expect(lesson(35).filename).toBe('L35_ELA_TE_G6_U3_CA_CoreL30_ELA_TE_G6_U3_CA_Core')
    expect(lesson(39).filename).toBe('L309_ELA_TE_G6_U3_CA_Core')
    expect(lesson(30).filename).toBe('L30_ELA_TE_G6_U3_CA_Core')
  })
})

describe('parseOutline input checks', () => {
  it('rejects text without the outline header row', () => {
    expect(() => parseOutline('Name,Age\nBob,3\n')).toThrow(OutlineParseError)
    expect(() => parseOutline('')).toThrow(OutlineParseError)
    expect(() => parseOutline('<!DOCTYPE html><html><body>Sign in</body></html>')).toThrow(
      OutlineParseError,
    )
  })

  it('accepts LF line endings as well as the sample CRLF', () => {
    const lf = parseOutline(sampleOutlineCsv().replace(/\r\n/g, '\n'))
    expect(lf.items.filter((item) => !item.isFlex)).toHaveLength(41)
    expect(lf.unit.isbn).toBe('9780786838653')
  })
})
