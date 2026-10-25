// R7 / R8 / R5 / R10: what goes into a lesson's prompt. Contract: src/generation/README.md.
import { describe, expect, it } from 'vitest'
import { buildLessonPrompt, type LessonPromptInput } from './prompt_builder'
import { DEFAULT_PROMPT_TEMPLATE, PromptTemplate } from './prompt_template'

const TEMPLATE: PromptTemplate = {
  system: 'SYSTEM-INSTRUCTIONS-MARKER',
  styleGuide: 'STYLE-GUIDE-MARKER',
  typeGuidance: {
    spark: 'TYPE-GUIDANCE-SPARK',
    core_reading: 'TYPE-GUIDANCE-CORE-READING',
    core_writing: 'TYPE-GUIDANCE-CORE-WRITING',
    academic_discussion: 'TYPE-GUIDANCE-DISCUSSION',
    writing: 'TYPE-GUIDANCE-WRITING',
    flex: 'TYPE-GUIDANCE-FLEX',
  },
}

function input(overrides: Partial<LessonPromptInput> = {}): LessonPromptInput {
  return {
    promptVersion: { id: 'pv-1', version: 3, template: TEMPLATE },
    unit: { grade: 6, unitNumber: 4, anchorTextTitle: 'Placeholder Anchor Novel' },
    arc: { name: 'Investigation 1', description: 'ARC-DESCRIPTION-MARKER' },
    lesson: {
      id: 'lesson-5',
      lessonNumber: 5,
      isFlex: false,
      lessonType: 'Core Writing',
      days: 1,
      filename: 'L5_TE',
      textDependentQuestion: 'TDQ-MARKER?',
      description: 'THIS-LESSON-DESCRIPTION',
      textSet: 'TEXT-SET-MARKER',
      homework: 'HOMEWORK-MARKER',
      performanceTaskSkill: 'PT-SKILL-MARKER',
      foundationalSkills: 'FOUNDATIONAL-MARKER',
      vocabulary: 'VOCABULARY-MARKER',
    },
    standards: [
      { code: 'RL.6.1', kind: 'focus', text: 'FULL-TEXT-RL-6-1' },
      { code: 'W.6.2.a', kind: 'focus', text: 'FULL-TEXT-W-6-2-A' },
      { code: 'L.6.4', kind: 'supporting', text: 'FULL-TEXT-L-6-4' },
      { code: 'LIB.6.2.1.a', kind: 'media', text: 'FULL-TEXT-LIB' },
      { code: 'ELD.PI.6.6', kind: 'eld', text: 'FULL-TEXT-ELD-PI-6-6' },
      { code: 'RL.6.99', kind: 'supporting', text: null },
    ],
    previousLesson: { lessonNumber: 4, description: 'PREVIOUS-DESCRIPTION' },
    nextLesson: { lessonNumber: 6, description: 'NEXT-DESCRIPTION' },
    eldInput: null,
    ...overrides,
  }
}

function fullText(prompt: { system: string; prompt: string }) {
  return `${prompt.system}\n${prompt.prompt}`
}

describe('buildLessonPrompt', () => {
  it('puts the template system instructions and style guide in the system prompt', () => {
    const prompt = buildLessonPrompt(input())
    expect(prompt.system).toContain('SYSTEM-INSTRUCTIONS-MARKER')
    expect(prompt.system).toContain('STYLE-GUIDE-MARKER')
  })

  it('records the prompt version it was built from', () => {
    expect(buildLessonPrompt(input()).promptVersionId).toBe('pv-1')
  })

  it('includes the full text of every focus and supporting standard with its code', () => {
    const text = fullText(buildLessonPrompt(input()))
    ;['RL.6.1', 'W.6.2.a', 'L.6.4'].forEach((code) => expect(text).toContain(code))
    ;['FULL-TEXT-RL-6-1', 'FULL-TEXT-W-6-2-A', 'FULL-TEXT-L-6-4'].forEach((t) =>
      expect(text).toContain(t),
    )
  })

  it('includes ELD and media standards with their text, and unknown codes by code', () => {
    const text = fullText(buildLessonPrompt(input()))
    expect(text).toContain('FULL-TEXT-ELD-PI-6-6')
    expect(text).toContain('FULL-TEXT-LIB')
    expect(text).toContain('RL.6.99')
  })

  it('includes the outline row', () => {
    const text = fullText(buildLessonPrompt(input()))
    ;[
      'THIS-LESSON-DESCRIPTION',
      'TDQ-MARKER?',
      'TEXT-SET-MARKER',
      'HOMEWORK-MARKER',
      'PT-SKILL-MARKER',
      'FOUNDATIONAL-MARKER',
      'VOCABULARY-MARKER',
      'Core Writing',
    ].forEach((value) => expect(text).toContain(value))
  })

  it('states the lesson duration as 50 minutes per day', () => {
    expect(fullText(buildLessonPrompt(input()))).toContain('50')
    const double = input()
    double.lesson = { ...double.lesson, days: 2 }
    expect(fullText(buildLessonPrompt(double))).toContain('100')
  })

  it('includes the arc description and the previous and next lesson descriptions', () => {
    const text = fullText(buildLessonPrompt(input()))
    expect(text).toContain('ARC-DESCRIPTION-MARKER')
    expect(text).toContain('PREVIOUS-DESCRIPTION')
    expect(text).toContain('NEXT-DESCRIPTION')
  })

  it('handles the first and last lesson (no previous or next)', () => {
    const prompt = buildLessonPrompt(input({ previousLesson: null, nextLesson: null }))
    expect(fullText(prompt)).toContain('THIS-LESSON-DESCRIPTION')
  })

  it('includes non-empty ELD input fields when present (R5)', () => {
    const text = fullText(
      buildLessonPrompt(
        input({
          eldInput: {
            languageObjective: 'ELD-LANGUAGE-OBJECTIVE',
            ideasLookBack: 'ELD-LOOK-BACK-IDEA',
            routines: 'ELD-ROUTINES',
          },
        }),
      ),
    )
    expect(text).toContain('ELD-LANGUAGE-OBJECTIVE')
    expect(text).toContain('ELD-LOOK-BACK-IDEA')
    expect(text).toContain('ELD-ROUTINES')
  })

  it.each([
    ['Core Writing', 'TYPE-GUIDANCE-CORE-WRITING'],
    ['Core Writing (Double Lesson)', 'TYPE-GUIDANCE-CORE-WRITING'],
    ['Core Reading', 'TYPE-GUIDANCE-CORE-READING'],
    ['Academic Discussion', 'TYPE-GUIDANCE-DISCUSSION'],
    ['Spark 2', 'TYPE-GUIDANCE-SPARK'],
    ['Writing', 'TYPE-GUIDANCE-WRITING'],
    ['End-of-Arc Flex Day', 'TYPE-GUIDANCE-FLEX'],
  ])('uses the template guidance for a %s lesson only (R8)', (lessonType, guidance) => {
    const base = input()
    const text = fullText(buildLessonPrompt({ ...base, lesson: { ...base.lesson, lessonType } }))
    expect(text).toContain(guidance)
    Object.values(TEMPLATE.typeGuidance)
      .filter((other) => other !== guidance)
      .forEach((other) => expect(text).not.toContain(other))
  })
})

describe('DEFAULT_PROMPT_TEMPLATE (R8, R10)', () => {
  it('is a valid template', () => {
    expect(PromptTemplate.safeParse(DEFAULT_PROMPT_TEMPLATE).success).toBe(true)
  })

  it('has guidance for each outline lesson type', () => {
    ;(
      ['spark', 'core_reading', 'core_writing', 'academic_discussion', 'writing', 'flex'] as const
    ).forEach((type) =>
      expect(DEFAULT_PROMPT_TEMPLATE.typeGuidance[type]?.length ?? 0).toBeGreaterThan(20),
    )
  })

  it('asks Core Writing for teacher modeling and a writing task', () => {
    const guidance = DEFAULT_PROMPT_TEMPLATE.typeGuidance.core_writing ?? ''
    expect(guidance).toMatch(/model/i)
    expect(guidance).toMatch(/writing task/i)
  })

  it('asks Academic Discussion for a discussion protocol', () => {
    expect(DEFAULT_PROMPT_TEMPLATE.typeGuidance.academic_discussion ?? '').toMatch(/protocol/i)
  })
})
