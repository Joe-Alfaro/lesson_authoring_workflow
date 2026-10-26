// Prompt-tuning rules the code enforces on a validated lesson (M2 smoke run, D-039): rewriting is
// free, while rejecting the output would cost a repair call. Contract: src/generation/README.md.
import { withContentIds } from '../lesson/content_ids'
import type { Block, LessonContent, Part, Section } from '../lesson/schema'
import type { PulseCheckOption } from './prompt_builder'

/** The outline's own cap: "Cap at 6 words per lesson". */
export const MAX_ADDRESSED_VOCABULARY = 6

/** "At most two per lesson" (D-045 (4)). */
export const MAX_TEACHER_TIPS = 2

/** "1-2 sentences for quick checks" (D-045 (4)). */
export const MAX_QUICK_CHECK_EXEMPLAR_SENTENCES = 2

export interface NormalizeOptions {
  /** Where each pulse check's correct option goes (`pulseCheckCorrectOption(lessonNumber)`). */
  pulseCheckCorrectOption: PulseCheckOption
}

const LETTERS = ['A', 'B', 'C', 'D'] as const

/** Moves the correct option to `letter`; the wrong options keep their order. */
function placeCorrectOption(block: Block, letter: PulseCheckOption): Block {
  if (block.type !== 'pulse_check') {
    return block
  }
  const correct = block.options.find((option) => option.correct)
  if (!correct) {
    return block
  }
  const wrong = block.options.filter((option) => option !== correct)
  const index = LETTERS.indexOf(letter)
  return { ...block, options: [...wrong.slice(0, index), correct, ...wrong.slice(index)] }
}

/** "A", "a", "Part a", "Part A:" -> "Part A"; other labels (flex "Huddle 1") are kept. */
function partLabel(label: string | undefined, index: number): string | undefined {
  if (label === undefined || label.trim() === '') {
    return `Part ${String.fromCharCode(65 + index)}`
  }
  const letter = label.trim().match(/^(?:part\s*)?([a-z])\s*[:.)-]?$/i)?.[1]
  return letter ? `Part ${letter.toUpperCase()}` : label
}

/**
 * A sentence ends at ".", "!" or "?" (and a closing quote or bracket right after it) followed by
 * whitespace and an uppercase letter or an opening quote, so "p. 4" is not a sentence end.
 */
const SENTENCE_END = /[.!?]["'\u201d\u2019)\]]*(?=\s+[\p{Lu}"'\u201c\u2018])/gu

/** The first `max` sentences of `text`, or `text` itself when it has no more. */
function firstSentences(text: string, max: number): string {
  const ends = [...text.matchAll(SENTENCE_END)]
  const end = ends[max - 1]
  return end === undefined ? text : text.slice(0, end.index + end[0].length)
}

/** Discussion questions in Learning in Action of an Academic Discussion take longer exemplars. */
function hasQuickChecks(content: LessonContent, section: Section): boolean {
  return !(
    content.frontMatter.type === 'academic_discussion' && section.kind === 'learning_in_action'
  )
}

function normalizeBlock(block: Block, options: NormalizeOptions, quickChecks: boolean): Block {
  if (block.type === 'ask' && quickChecks) {
    return {
      ...block,
      exemplar: firstSentences(block.exemplar, MAX_QUICK_CHECK_EXEMPLAR_SENTENCES),
    }
  }
  return placeCorrectOption(block, options.pulseCheckCorrectOption)
}

function normalizeSection(
  section: Section,
  options: NormalizeOptions,
  quickChecks: boolean,
  keepTip: () => boolean,
): Section {
  const parts = section.parts.map((part, index): Part => {
    const blocks = part.blocks.flatMap((block): Block[] => {
      if (block.type !== 'teacher_tip' || keepTip()) {
        return [block]
      }
      // A part never loses its only block (the schema needs one): an extra tip that is the whole
      // part stays as a plain paragraph, so the lesson still has at most two tips.
      return part.blocks.length === 1 ? [{ type: 'paragraph', text: block.text }] : []
    })
    return {
      ...part,
      ...(section.kind === 'learning_in_action' ? { label: partLabel(part.label, index) } : {}),
      blocks: blocks.map((block) => normalizeBlock(block, options, quickChecks)),
    }
  })
  return { ...section, parts }
}

type PulseCheck = Extract<Block, { type: 'pulse_check' }>

function isCorrectLongest(check: PulseCheck): boolean {
  const correct = check.options.find((option) => option.correct)
  if (!correct) {
    return false
  }
  return check.options.every(
    (option) => option === correct || option.text.length < correct.text.length,
  )
}

/**
 * Non-blocking review hints for what the code can't rewrite (D-045 (4), PM: hint-only): today, a
 * correct pulse check option that is strictly the longest in every pulse check of the lesson.
 */
export function polishHints(content: LessonContent): string[] {
  const checks = content.body.sections
    .flatMap((section) => section.parts.flatMap((part) => part.blocks))
    .filter((block): block is PulseCheck => block.type === 'pulse_check')
  if (checks.length === 0 || !checks.every(isCorrectLongest)) {
    return []
  }
  return [
    'In every pulse check the correct option is the longest one, which gives the answer away. Make at least one wrong option as long as the correct one or longer.',
  ]
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap(strings)
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(strings)
  }
  return []
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Case-insensitive and at a word start, so "claim" matches "Claims". A final "e" is optional, so
 * "cite" matches "citing".
 */
function usesTerm(text: string, term: string): boolean {
  const trimmed = term.trim()
  if (!trimmed) {
    return false
  }
  const stem = escapeRegExp(trimmed).replace(/e$/i, 'e?')
  return new RegExp(`(?<![\\p{L}\\p{N}])${stem}`, 'iu').test(text)
}

/**
 * Applies the code-enforced prompt tuning: the pulse check answer position, "Part A/B" labels in
 * Learning in Action, at most `MAX_ADDRESSED_VOCABULARY` addressed words the lesson uses, at most
 * `MAX_TEACHER_TIPS` teacher tips (the first ones) and quick-check exemplars of at most
 * `MAX_QUICK_CHECK_EXEMPLAR_SENTENCES` sentences. Pure: returns a new lesson and leaves `content`
 * alone.
 */
export function normalizeLessonContent(
  content: LessonContent,
  options: NormalizeOptions,
): LessonContent {
  const { vocabulary, ...rest } = content.body
  const bodyText = strings(rest).join('\n')
  const addressed = vocabulary.addressed
    .filter((entry) => usesTerm(bodyText, entry.term))
    .slice(0, MAX_ADDRESSED_VOCABULARY)
  let tipsKept = 0
  const keepTip = () => {
    tipsKept += 1
    return tipsKept <= MAX_TEACHER_TIPS
  }
  // Saved with ids, so the editor, versions and AI assist share them from the start (N1).
  return withContentIds({
    ...content,
    body: {
      ...content.body,
      sections: content.body.sections.map((section) =>
        normalizeSection(section, options, hasQuickChecks(content, section), keepTip),
      ),
      vocabulary: { ...vocabulary, addressed },
    },
  })
}
