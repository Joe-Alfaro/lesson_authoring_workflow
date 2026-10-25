// Prompt-tuning rules the code enforces after the model answers (M2 smoke run, R7, R10).
// Contract: src/generation/README.md, section "Post-processing".
import { describe, expect, it } from 'vitest'
import { coreLessonContent, flexLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'
import { LessonContent, validateLesson, type Block, type Section } from '../lesson/schema'
import { MAX_ADDRESSED_VOCABULARY, normalizeLessonContent } from './post_process'

const LETTERS = ['A', 'B', 'C', 'D'] as const

function learningInAction(content: LessonContent): Section {
  return content.body.sections.find((section) => section.kind === 'learning_in_action')!
}

function pulseChecks(content: LessonContent) {
  return content.body.sections
    .flatMap((section) => section.parts.flatMap((part) => part.blocks))
    .filter(
      (block): block is Extract<Block, { type: 'pulse_check' }> => block.type === 'pulse_check',
    )
}

describe('normalizeLessonContent: pulse check answer position', () => {
  it.each(LETTERS)('moves the correct option to position %s', (letter) => {
    const content = coreLessonContent()
    const [check] = pulseChecks(content)
    const correctText = check!.options.find((option) => option.correct)!.text

    const result = normalizeLessonContent(content, { pulseCheckCorrectOption: letter })

    const options = pulseChecks(result)[0]!.options
    expect(options).toHaveLength(4)
    expect(options.map((option) => option.correct)).toEqual(
      LETTERS.map((other) => other === letter),
    )
    expect(options[LETTERS.indexOf(letter)]!.text).toBe(correctText)
  })

  it('keeps every option with its own rationale and the wrong options in their order', () => {
    const content = coreLessonContent()
    const original = pulseChecks(content)[0]!.options
    const wrong = original.filter((option) => !option.correct)

    const result = normalizeLessonContent(content, { pulseCheckCorrectOption: 'C' })

    const options = pulseChecks(result)[0]!.options
    expect(options.filter((option) => !option.correct)).toEqual(wrong)
    expect([...options].sort((a, b) => a.text.localeCompare(b.text))).toEqual(
      [...original].sort((a, b) => a.text.localeCompare(b.text)),
    )
  })

  it('does not mutate its input', () => {
    const content = coreLessonContent()
    const before = structuredClone(content)
    normalizeLessonContent(content, { pulseCheckCorrectOption: 'D' })
    expect(content).toEqual(before)
  })
})

describe('normalizeLessonContent: Learning in Action part labels', () => {
  it.each([
    [
      ['A', 'B'],
      ['Part A', 'Part B'],
    ],
    [
      ['a', 'b'],
      ['Part A', 'Part B'],
    ],
    [
      ['Part a', 'part B'],
      ['Part A', 'Part B'],
    ],
    [
      ['Part A:', 'Part B.'],
      ['Part A', 'Part B'],
    ],
    [
      ['Part A', 'Part B'],
      ['Part A', 'Part B'],
    ],
  ])('normalizes %j to %j', (labels, expected) => {
    const content = coreLessonContent()
    learningInAction(content).parts.forEach((part, index) => {
      part.label = labels[index]
    })

    const result = normalizeLessonContent(content, { pulseCheckCorrectOption: 'A' })

    expect(learningInAction(result).parts.map((part) => part.label)).toEqual(expected)
  })

  it('labels unlabeled Learning in Action parts by position', () => {
    const content = coreLessonContent()
    learningInAction(content).parts.forEach((part) => {
      delete part.label
    })

    const result = normalizeLessonContent(content, { pulseCheckCorrectOption: 'A' })

    expect(learningInAction(result).parts.map((part) => part.label)).toEqual(['Part A', 'Part B'])
  })

  it('keeps flex-day huddle labels and leaves other sections alone', () => {
    const result = normalizeLessonContent(flexLessonContent(), { pulseCheckCorrectOption: 'A' })

    expect(learningInAction(result).parts.map((part) => part.label)).toEqual([
      'Huddle 1',
      'Huddle 2',
      'Huddle 3',
    ])
    result.body.sections
      .filter((section) => section.kind !== 'learning_in_action')
      .forEach((section) => section.parts.forEach((part) => expect(part.label).toBeUndefined()))
  })
})

describe('normalizeLessonContent: addressed vocabulary', () => {
  const entry = (term: string) => ({ term, definition: `Definition of ${term}.` })

  it('keeps only addressed words the lesson uses outside the vocabulary list', () => {
    const content = coreLessonContent()
    // "claim" and "detail" are used in the fixture's blocks; "talons" and "eavesdropper" are not.
    content.body.vocabulary.addressed = [
      entry('claim'),
      entry('talons'),
      entry('detail'),
      entry('eavesdropper'),
    ]

    const result = normalizeLessonContent(content, { pulseCheckCorrectOption: 'A' })

    expect(result.body.vocabulary.addressed.map((word) => word.term)).toEqual(['claim', 'detail'])
  })

  it('matches case-insensitively and counts inflected forms that start with the term', () => {
    const content = coreLessonContent()
    content.body.vocabulary.addressed = [entry('Claim'), entry('cite')]
    // The fixture says "Claims and Details" in the title and "cite" / "citing" in its blocks.

    const result = normalizeLessonContent(content, { pulseCheckCorrectOption: 'A' })

    expect(result.body.vocabulary.addressed.map((word) => word.term)).toEqual(['Claim', 'cite'])
  })

  it(`keeps at most ${MAX_ADDRESSED_VOCABULARY} addressed words, in their order`, () => {
    expect(MAX_ADDRESSED_VOCABULARY).toBe(6)
    const content = coreLessonContent()
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']
    content.body.vocabulary.addressed = words.map(entry)
    learningInAction(content).parts[0]!.blocks.push({
      type: 'paragraph',
      text: `Use these words: ${words.join(', ')}.`,
    })

    const result = normalizeLessonContent(content, { pulseCheckCorrectOption: 'A' })

    expect(result.body.vocabulary.addressed.map((word) => word.term)).toEqual(words.slice(0, 6))
  })

  it('leaves support vocabulary alone', () => {
    const content = coreLessonContent()
    content.body.vocabulary.support = [entry('zephyr')]
    const result = normalizeLessonContent(content, { pulseCheckCorrectOption: 'A' })
    expect(result.body.vocabulary.support).toEqual([entry('zephyr')])
  })
})

describe('normalizeLessonContent: result', () => {
  it('is still a valid lesson', () => {
    const result = normalizeLessonContent(coreLessonContent(), { pulseCheckCorrectOption: 'B' })
    expect(validateLesson(result, { focusStandards: ['RL.6.1'], days: 1 }).ok).toBe(true)
  })
})
