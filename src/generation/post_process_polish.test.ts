// M5 prompt polish the code enforces (D-045 (4), Sonnet probe): at most two teacher tips, quick-check
// exemplars of at most two sentences, and a repair hint when the correct pulse check option is
// always the longest. Contract: src/generation/README.md, section "M5 robustness".
import { describe, expect, it } from 'vitest'
import { coreLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'
import { validateLesson, type Block, type LessonContent, type Section } from '../lesson/schema'
import {
  MAX_QUICK_CHECK_EXEMPLAR_SENTENCES,
  MAX_TEACHER_TIPS,
  normalizeLessonContent,
  polishHints,
} from './post_process'

type PulseCheck = Extract<Block, { type: 'pulse_check' }>

function section(content: LessonContent, kind: Section['kind']): Section {
  return content.body.sections.find((s) => s.kind === kind)!
}

function blocks(content: LessonContent): Block[] {
  return content.body.sections.flatMap((s) => s.parts.flatMap((part) => part.blocks))
}

function tips(content: LessonContent): string[] {
  return blocks(content).flatMap((block) => (block.type === 'teacher_tip' ? [block.text] : []))
}

function pulseChecks(content: LessonContent): PulseCheck[] {
  return blocks(content).filter((block): block is PulseCheck => block.type === 'pulse_check')
}

function askBlock(question: string, exemplar: string): Block {
  return { type: 'ask', question, exemplar }
}

/** The exemplar of the ask whose question is `question`. */
function exemplarOf(content: LessonContent, question: string): string {
  const ask = blocks(content).find((block) => block.type === 'ask' && block.question === question)
  return ask?.type === 'ask' ? ask.exemplar : ''
}

const normalize = (content: LessonContent) =>
  normalizeLessonContent(content, { pulseCheckCorrectOption: 'A' })

describe('normalizeLessonContent: teacher tips', () => {
  it('keeps the first two teacher tips in lesson order and drops the rest', () => {
    expect(MAX_TEACHER_TIPS).toBe(2)
    const content = coreLessonContent()
    // Document order: Launch tip, the fixture's Literacy Lab tip, two Learning in Action tips.
    const [labTip] = tips(content)
    section(content, 'launch').parts[0]!.blocks.push({ type: 'teacher_tip', text: 'Tip one.' })
    const action = section(content, 'learning_in_action').parts[0]!.blocks
    action.push({ type: 'teacher_tip', text: 'Tip three.' })
    action.push({ type: 'teacher_tip', text: 'Tip four.' })
    const otherBlocks = blocks(content).filter((block) => block.type !== 'teacher_tip').length

    const result = normalize(content)

    expect(tips(result)).toEqual(['Tip one.', labTip])
    expect(blocks(result).filter((block) => block.type !== 'teacher_tip')).toHaveLength(otherBlocks)
    expect(validateLesson(result, { focusStandards: ['RL.6.1'], days: 1 }).ok).toBe(true)
  })

  it('leaves a lesson with two or fewer tips alone', () => {
    const content = coreLessonContent()
    section(content, 'launch').parts[0]!.blocks.push({ type: 'teacher_tip', text: 'Tip one.' })
    const before = tips(content)
    expect(before).toHaveLength(2)

    expect(tips(normalize(content))).toEqual(before)
  })
})

describe('normalizeLessonContent: quick-check exemplars', () => {
  it('trims a quick-check exemplar to its first two sentences', () => {
    expect(MAX_QUICK_CHECK_EXEMPLAR_SENTENCES).toBe(2)
    const content = coreLessonContent()
    const launch = section(content, 'launch').parts[0]!.blocks
    launch.push(
      askBlock(
        'Q-THREE',
        'The narrator hides the note. She worries that someone will find it. Later she burns it.',
      ),
      askBlock('Q-MARKS', 'Is he brave? Yes! He steps forward first.'),
      askBlock('Q-ABBREV', 'On p. 4 the narrator hides. On pp. 16–22 she runs. Then she stops.'),
      askBlock('Q-QUOTE', 'The text says "I ran." That shows fear. It also shows speed.'),
      askBlock('Q-TWO', 'The narrator hides the note. She is afraid.'),
    )

    const result = normalize(content)

    expect(exemplarOf(result, 'Q-THREE')).toBe(
      'The narrator hides the note. She worries that someone will find it.',
    )
    expect(exemplarOf(result, 'Q-MARKS')).toBe('Is he brave? Yes!')
    // "p. 4" and "pp. 16–22" are not sentence ends.
    expect(exemplarOf(result, 'Q-ABBREV')).toBe(
      'On p. 4 the narrator hides. On pp. 16–22 she runs.',
    )
    expect(exemplarOf(result, 'Q-QUOTE')).toBe('The text says "I ran." That shows fear.')
    expect(exemplarOf(result, 'Q-TWO')).toBe('The narrator hides the note. She is afraid.')
    expect(validateLesson(result, { focusStandards: ['RL.6.1'], days: 1 }).ok).toBe(true)
  })

  it('keeps longer exemplars in Learning in Action of an Academic Discussion lesson, and trims the rest', () => {
    const content = coreLessonContent()
    content.frontMatter.type = 'academic_discussion'
    const long = 'First idea here. Second idea here. Third idea here. Fourth idea here.'
    section(content, 'learning_in_action').parts[1]!.blocks.push(askBlock('Q-DISCUSS', long))
    section(content, 'launch').parts[0]!.blocks.push(askBlock('Q-LAUNCH', long))

    const result = normalize(content)

    expect(exemplarOf(result, 'Q-DISCUSS')).toBe(long)
    expect(exemplarOf(result, 'Q-LAUNCH')).toBe('First idea here. Second idea here.')
  })

  it('does not mutate its input', () => {
    const content = coreLessonContent()
    section(content, 'launch').parts[0]!.blocks.push(askBlock('Q', 'One. Two. Three.'))
    const before = structuredClone(content)
    normalize(content)
    expect(content).toEqual(before)
  })
})

describe('polishHints: pulse check option length', () => {
  function makeCorrectLongest(check: PulseCheck) {
    const correct = check.options.find((option) => option.correct)!
    correct.text = `${correct.text} It shows the character's nervous feelings on the first day of school.`
  }

  it('has no hint when the correct option is not the longest', () => {
    // The fixture's correct option is shorter than one distractor.
    expect(polishHints(coreLessonContent())).toEqual([])
  })

  it('asks for a shorter correct option when it is the longest in every pulse check', () => {
    const content = coreLessonContent()
    pulseChecks(content).forEach(makeCorrectLongest)

    const hints = polishHints(content)

    expect(hints).toHaveLength(1)
    expect(hints[0]).toMatch(/pulse check/i)
    expect(hints[0]).toMatch(/longest/i)
  })

  it('is about a pattern: no hint when only some pulse checks have the longest correct option', () => {
    const content = coreLessonContent()
    const part = section(content, 'learning_in_action').parts[1]!
    const original = pulseChecks(content)[0]!
    const second = structuredClone(original)
    makeCorrectLongest(original)
    part.blocks.push(second)

    expect(polishHints(content)).toEqual([])
  })

  it('needs the correct option to be strictly the longest (a tie is fine)', () => {
    const content = coreLessonContent()
    const check = pulseChecks(content)[0]!
    const longestWrong = Math.max(
      ...check.options.filter((o) => !o.correct).map((o) => o.text.length),
    )
    const correct = check.options.find((o) => o.correct)!
    correct.text = correct.text.padEnd(longestWrong, '.')
    expect(correct.text.length).toBe(longestWrong)

    expect(polishHints(content)).toEqual([])
  })

  it('has no hint for a lesson without pulse checks', () => {
    const content = coreLessonContent()
    content.body.sections.forEach((s) =>
      s.parts.forEach((part) => {
        part.blocks = part.blocks.filter((block) => block.type !== 'pulse_check')
      }),
    )
    expect(polishHints(content)).toEqual([])
  })
})
