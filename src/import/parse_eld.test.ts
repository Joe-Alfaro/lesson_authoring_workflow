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
