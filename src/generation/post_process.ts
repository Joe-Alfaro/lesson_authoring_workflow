// Prompt-tuning rules the code enforces on a validated lesson (M2 smoke run, D-039): rewriting is
// free, while rejecting the output would cost a repair call. Contract: src/generation/README.md.
import { withContentIds } from '../lesson/content_ids'
import type { Block, LessonContent, Part, Section } from '../lesson/schema'
import type { PulseCheckOption } from './prompt_builder'

/** The outline's own cap: "Cap at 6 words per lesson". */
export const MAX_ADDRESSED_VOCABULARY = 6

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

function normalizeSection(section: Section, options: NormalizeOptions): Section {
  const parts = section.parts.map((part, index): Part => ({
    ...part,
    ...(section.kind === 'learning_in_action' ? { label: partLabel(part.label, index) } : {}),
    blocks: part.blocks.map((block) => placeCorrectOption(block, options.pulseCheckCorrectOption)),
  }))
  return { ...section, parts }
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
 * Learning in Action, and at most `MAX_ADDRESSED_VOCABULARY` addressed words the lesson uses. Pure:
 * returns a new lesson and leaves `content` alone.
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
  // Saved with ids, so the editor, versions and AI assist share them from the start (N1).
  return withContentIds({
    ...content,
    body: {
      ...content.body,
      sections: content.body.sections.map((section) => normalizeSection(section, options)),
      vocabulary: { ...vocabulary, addressed },
    },
  })
}
