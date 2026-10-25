// D-016 lesson schema and the R7 cross-field checks. Contract: src/lesson/README.md.
import { describe, expect, it } from 'vitest'
import {
  coreLessonContent,
  FIXTURE_FOCUS,
  flexLessonContent,
} from '../../tests/fixtures/lesson/lesson_fixture'
import {
  BLOCK_TYPES,
  LessonBody,
  LessonContent,
  lessonBodyJsonSchema,
  lessonTypeFromOutline,
  validateLesson,
  type LessonValidationError,
} from './schema'

const ONE_DAY = { focusStandards: FIXTURE_FOCUS, days: 1 }

function errorsOf(content: unknown, expectations = ONE_DAY): LessonValidationError[] {
  const result = validateLesson(content, expectations)
  if (result.ok) {
    throw new Error('expected the lesson to be invalid')
  }
  return result.errors
}

function learningInAction(content: LessonContent) {
  const section = content.body.sections.find((s) => s.kind === 'learning_in_action')
  if (!section) {
    throw new Error('fixture has no Learning in Action section')
  }
  return section
}

describe('LessonContent (D-016)', () => {
  it('accepts the core and flex fixture lessons', () => {
    expect(LessonContent.safeParse(coreLessonContent()).success).toBe(true)
    expect(LessonContent.safeParse(flexLessonContent()).success).toBe(true)
  })

  it('validateLesson returns the parsed lesson for a valid fixture', () => {
    const result = validateLesson(coreLessonContent(), ONE_DAY)
    expect(result).toEqual({ ok: true, lesson: expect.objectContaining({ schemaVersion: 1 }) })
  })

  it('accepts a flex day with no lesson number', () => {
    const content = flexLessonContent()
    expect(content.frontMatter.number).toBeNull()
    expect(validateLesson(content, ONE_DAY).ok).toBe(true)
  })

  it('accepts every code shape in the standards reference data', () => {
    const content = coreLessonContent()
    content.frontMatter.supportingStandards = ['L.6.4', 'W.6.2.a', 'RH.6-8.1', 'LIB.6.2.1.a']
    content.frontMatter.eldStandards = [
      { code: 'ELD.PI.6.6.a', levels: ['Em', 'Ex', 'Br'] },
      { code: 'ELD.PII.6.3', levels: ['Br'] },
    ]
    expect(validateLesson(content, ONE_DAY).ok).toBe(true)
  })

  it('exposes the D-016 block types', () => {
    expect([...BLOCK_TYPES].sort()).toEqual(
      [
        'routine',
        'teach',
        'paragraph',
        'say',
        'directions',
        'ask',
        'connection',
        'display',
        'list',
        'table',
        'teacher_tip',
        'sentence_starter',
        'pulse_check',
        'check_for_understanding',
        'reflection',
        'eld_instructions',
        'student_support',
        'rubric',
      ].sort(),
    )
  })
})

describe('validateLesson: schema errors', () => {
  it('fails an unknown block type with a schema error pointing at the block', () => {
    const content = coreLessonContent()
    const blocks = learningInAction(content).parts[0]!.blocks as unknown[]
    blocks.push({ type: 'video', url: 'https://example.com/clip' })

    const errors = errorsOf(content)

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'schema',
        path: expect.stringMatching(/^body\.sections\.2\.parts\.0\.blocks\.\d+/),
      }),
    )
  })

  it('fails an Ask without an exemplar response, naming the missing field', () => {
    const content = coreLessonContent()
    const ask = learningInAction(content).parts[0]!.blocks.find((b) => b.type === 'ask') as Record<
      string,
      unknown
    >
    delete ask.exemplar

    expect(errorsOf(content)).toContainEqual(
      expect.objectContaining({ code: 'schema', path: expect.stringMatching(/exemplar$/) }),
    )
  })

  it('fails a pulse check that does not have exactly one correct option', () => {
    const content = coreLessonContent()
    const pulse = learningInAction(content).parts[1]!.blocks.find((b) => b.type === 'pulse_check')
    if (pulse?.type !== 'pulse_check') {
      throw new Error('fixture has no pulse check')
    }
    pulse.options[1]!.correct = true

    expect(errorsOf(content).length).toBeGreaterThan(0)
  })

  it('rejects input that is not a lesson at all', () => {
    expect(errorsOf({ title: 42 })[0]).toEqual(
      expect.objectContaining({ code: 'schema', message: expect.any(String) }),
    )
  })

  it('reports every error with a non-empty path and message', () => {
    const content = coreLessonContent()
    content.body.sections[0]!.minutes = 10

    // Three cross-field errors: minutes, RL.6.2 missing from front matter, RL.6.2 untagged.
    const errors = errorsOf(content, { focusStandards: ['RL.6.1', 'RL.6.2'], days: 1 })

    expect(errors.length).toBeGreaterThanOrEqual(3)
    errors.forEach((error) => {
      expect(error.path).toEqual(expect.any(String))
      expect(error.message.length).toBeGreaterThan(0)
    })
  })
})

describe('validateLesson: section minutes (R7)', () => {
  it('fails when section minutes do not add up to 50, giving both totals', () => {
    const content = coreLessonContent()
    content.body.sections[0]!.minutes = 10

    const errors = errorsOf(content)

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'minutes_total',
        path: 'body.sections',
        message: expect.stringMatching(/55.*50|50.*55/),
      }),
    )
  })

  it('expects 50 minutes per day for multi-day lessons', () => {
    const content = coreLessonContent()
    content.frontMatter.durationMinutes = 100

    expect(errorsOf(content, { focusStandards: FIXTURE_FOCUS, days: 2 })).toContainEqual(
      expect.objectContaining({
        code: 'minutes_total',
        message: expect.stringMatching(/50.*100|100.*50/),
      }),
    )

    learningInAction(content).minutes = 80
    expect(validateLesson(content, { focusStandards: FIXTURE_FOCUS, days: 2 }).ok).toBe(true)
  })

  it('fails when the front matter duration is not 50 x days', () => {
    const content = coreLessonContent()
    content.frontMatter.durationMinutes = 45

    expect(errorsOf(content)).toContainEqual(
      expect.objectContaining({ code: 'duration', path: 'frontMatter.durationMinutes' }),
    )
  })
})

describe('validateLesson: focus standards (R7)', () => {
  it('fails when a focus standard from the outline is missing from the front matter', () => {
    const content = coreLessonContent()
    learningInAction(content).parts[0]!.standards.push('RL.6.2')

    const errors = errorsOf(content, { focusStandards: ['RL.6.1', 'RL.6.2'], days: 1 })

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'focus_standard_missing',
        path: 'frontMatter.focusStandards',
        message: expect.stringContaining('RL.6.2'),
      }),
    )
    expect(errors.filter((e) => e.message.includes('RL.6.1'))).toEqual([])
  })

  it('fails when a focus standard is not tagged on any Learning in Action part', () => {
    const content = coreLessonContent()
    content.frontMatter.focusStandards = ['RL.6.1', 'RL.6.2']

    expect(errorsOf(content, { focusStandards: ['RL.6.1', 'RL.6.2'], days: 1 })).toContainEqual(
      expect.objectContaining({
        code: 'focus_standard_untagged',
        message: expect.stringContaining('RL.6.2'),
      }),
    )
  })

  it('does not count a tag on a Launch part as Learning in Action', () => {
    const content = coreLessonContent()
    content.frontMatter.focusStandards = ['RL.6.1', 'RL.6.2']
    content.body.sections[0]!.parts[0]!.standards.push('RL.6.2')

    expect(errorsOf(content, { focusStandards: ['RL.6.1', 'RL.6.2'], days: 1 })).toContainEqual(
      expect.objectContaining({ code: 'focus_standard_untagged' }),
    )
  })

  it('passes when every focus standard is in the front matter and tagged', () => {
    const content = coreLessonContent()
    content.frontMatter.focusStandards = ['RL.6.1', 'RL.6.2']
    learningInAction(content).parts[1]!.standards.push('RL.6.2')

    expect(validateLesson(content, { focusStandards: ['RL.6.1', 'RL.6.2'], days: 1 }).ok).toBe(true)
  })
})

describe('lessonBodyJsonSchema (structured output)', () => {
  it('is a plain JSON schema object for the generated body', () => {
    const schema = lessonBodyJsonSchema()

    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema)
    expect(schema).toEqual(
      expect.objectContaining({
        type: 'object',
        required: expect.arrayContaining(['title', 'objectives', 'sections']),
      }),
    )
  })

  it('describes every block type', () => {
    const text = JSON.stringify(lessonBodyJsonSchema())
    BLOCK_TYPES.forEach((type) => expect(text).toContain(`"${type}"`))
  })

  it('matches the Zod body schema: the fixture body parses', () => {
    expect(LessonBody.safeParse(coreLessonContent().body).success).toBe(true)
  })
})

describe('lessonTypeFromOutline (R8)', () => {
  it.each([
    ['Spark 1', 'spark'],
    ['Spark 3', 'spark'],
    ['Core Reading', 'core_reading'],
    ['Core Writing', 'core_writing'],
    ['Core Writing (Double Lesson)', 'core_writing'],
    ['Academic Discussion', 'academic_discussion'],
    ['Writing', 'writing'],
    ['End-of-Arc Flex Day', 'flex'],
    ['  core reading ', 'core_reading'],
    ['Something New', 'other'],
  ])('%s -> %s', (raw, expected) => {
    expect(lessonTypeFromOutline(raw)).toBe(expected)
  })
})
