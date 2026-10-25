// R5: optional ELD scope-and-sequence file, matched to outline items by arc and lesson type.
// Fixture rows and expectations: tests/fixtures/import/README.md. Contract: src/import/README.md.
import { describe, expect, it } from 'vitest'
import { filledEldCsv, sampleEldCsv, sampleOutlineCsv } from '../../tests/import_fixtures'
import { matchEldRows, parseEldFile } from './parse_eld'
import { parseOutline } from './parse_outline'

const items = parseOutline(sampleOutlineCsv()).items

function positionOfLesson(number: number): number {
  const item = items.find((candidate) => candidate.lessonNumber === number)
  if (!item) {
    throw new Error(`lesson ${number} missing`)
  }
  return item.position
}

const firstInv2Flex = items.find((item) => item.isFlex && item.arcName === 'Investigation 2')

describe('matchEldRows with a filled ELD file', () => {
  const { matches, warnings } = matchEldRows(parseEldFile(filledEldCsv()), items)
  const fieldsAt = (position: number | undefined) =>
    matches.find((match) => match.position === position)?.fields

  it('matches rows by arc and the order of their lesson type within the arc', () => {
    expect(fieldsAt(positionOfLesson(1))).toBeDefined()
    expect(fieldsAt(positionOfLesson(3))).toBeDefined()
    expect(fieldsAt(positionOfLesson(5))).toEqual({
      languageObjective: 'Students use transitions to connect two ideas in writing.',
    })
    expect(fieldsAt(positionOfLesson(11))).toEqual({
      ideasLookBack: "Partners check each other's transitions with a checklist.",
    })
    expect(fieldsAt(positionOfLesson(19))).toEqual({
      ideasLearningInAction:
        'Discussion roles card with sentence starters:\n• I agree with … because …\n• I want to add …',
    })
    expect(fieldsAt(firstInv2Flex?.position)).toEqual({
      ideasLaunch: 'Quick review game with unit vocabulary.',
    })
  })

  it('keeps only non-empty fields', () => {
    expect(fieldsAt(positionOfLesson(1))).toEqual({
      eldStandards: 'ELD.PI.6.6',
      languageObjective:
        'Students explain what a myth is using the frame “A myth is a story that…”.',
      ideasLaunch: 'Turn and talk: name a story that explains something in nature.',
      routines: 'Think-Pair-Share: oral rehearsal before writing.',
    })
    // The arc cell has a trailing space and the Launch cell holds only a space.
    expect(fieldsAt(positionOfLesson(3))).toEqual({
      contentObjective: 'Students identify why an author retells an old story.',
    })
    const lesson4 = fieldsAt(positionOfLesson(4))
    expect(lesson4 === undefined || Object.keys(lesson4).length === 0).toBe(true)
  })

  it('lists every unmatched row as a warning naming its filename', () => {
    expect(warnings).toHaveLength(3)
    const text = warnings.map((warning) => warning.message).join('\n')
    expect(text).toContain('L19B_DELD_TE_G6_U4_CA_Core')
    expect(text).toContain('L99_DELD_TE_G6_U4_CA_Core')
    expect(text).toContain('L98_DELD_TE_G6_U4_CA_Core')
  })

  it('never matches two rows to the same item', () => {
    const positions = matches.map((match) => match.position)
    expect(new Set(positions).size).toBe(positions.length)
  })
})

describe('parseEldFile on the sample ELD tab', () => {
  it('reads its 45 rows and produces no content fields', () => {
    const rows = parseEldFile(sampleEldCsv())
    expect(rows).toHaveLength(45)
    const { matches } = matchEldRows(rows, items)
    for (const match of matches) {
      expect(match.fields).toEqual({})
    }
  })
})

// D-028: when the arc and lesson type order finds no item, a row whose Filename starts with
// L<n>_ matches lesson n of the same arc (the sample ELD tab leaves most lesson types empty).
describe('matchEldRows falls back to the L<n>_ lesson number in the filename', () => {
  const rows = parseEldFile(sampleEldCsv())
  const { matches, warnings } = matchEldRows(rows, items)
  const warningText = warnings.map((warning) => warning.message).join('\n')
  const matchedPositions = new Set(matches.map((match) => match.position))

  it('matches the Spark and Investigation 1 rows to lessons 1-19 by number', () => {
    for (let number = 1; number <= 19; number += 1) {
      expect(matchedPositions.has(positionOfLesson(number)), `lesson ${number}`).toBe(true)
      expect(warningText).not.toMatch(new RegExp(`\\bL${number}_DELD`))
    }
  })

  it('still warns about rows whose lesson number is not in the outline', () => {
    for (const filename of ['L42', 'L43', 'L44', 'L45']) {
      expect(warningText).toContain(`${filename}_DELD_TE_G8_U4_CA_Core`)
    }
  })

  it('does not match a numbered row to a lesson in another arc', () => {
    // Rows L36-L38 say Investigation 2; lessons 36-38 are in Showcase.
    for (const filename of ['L36', 'L37', 'L38']) {
      expect(warningText).toContain(`${filename}_DELD_TE_G8_U4_CA_Core`)
    }
  })

  it('matches far more rows than the arc and type order alone', () => {
    expect(matches.length).toBeGreaterThanOrEqual(19)
    expect(warnings.length).toBeLessThan(rows.length - 19)
  })

  it('never matches two rows to the same item', () => {
    expect(matchedPositions.size).toBe(matches.length)
  })

  it('does not take an item already matched by arc and type', () => {
    const header = 'Filename,Arc,Lesson Type,Language Objective'
    const csv = [
      header,
      // Matches lesson 1 by arc and type.
      'L2_X,Spark,Spark 1,First',
      // Lesson 1 is taken, so the number fallback must not reuse it.
      'L1_X,Spark,,Second',
    ].join('\n')
    const result = matchEldRows(parseEldFile(csv), items)
    expect(result.matches).toEqual([
      { position: positionOfLesson(1), fields: { languageObjective: 'First' } },
    ])
    expect(result.warnings.map((warning) => warning.message).join('\n')).toContain('L1_X')
  })

  it('only uses filenames shaped like L<n>_', () => {
    const csv = [
      'Filename,Arc,Lesson Type',
      'L4B_X,Investigation 1,',
      'X4_X,Investigation 1,',
    ].join('\n')
    const result = matchEldRows(parseEldFile(csv), items)
    expect(result.matches).toEqual([])
    expect(result.warnings).toHaveLength(2)
  })
})

describe('parseEldFile cell cleanup', () => {
  it('turns every U+00A0 inside a cell into a normal space', () => {
    const csv =
      'Filename,Arc,Lesson Type,Language Objective\nL1_X,Spark,Spark 1,Students explain myths\n'
    const [row] = parseEldFile(csv)
    expect(row?.lessonType).toBe('Spark 1')
    expect(row?.fields).toEqual({ languageObjective: 'Students explain myths' })
  })
})
