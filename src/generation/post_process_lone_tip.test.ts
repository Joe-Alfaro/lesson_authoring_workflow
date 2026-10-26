// "At most two teacher tips" holds even when an extra tip is the only block of its part (M5
// validation edge case). Contract: src/generation/README.md, section "M5 robustness contract".
import { describe, expect, it } from 'vitest'
import { coreLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'
import { validateLesson, type Block, type LessonContent, type Section } from '../lesson/schema'
import { MAX_TEACHER_TIPS, normalizeLessonContent } from './post_process'

function section(content: LessonContent, kind: Section['kind']): Section {
  return content.body.sections.find((s) => s.kind === kind)!
}

function blocks(content: LessonContent): Block[] {
  return content.body.sections.flatMap((s) => s.parts.flatMap((part) => part.blocks))
}

function tips(content: LessonContent): string[] {
  return blocks(content).flatMap((block) => (block.type === 'teacher_tip' ? [block.text] : []))
}

const normalize = (content: LessonContent) =>
  normalizeLessonContent(content, { pulseCheckCorrectOption: 'A' })

describe('normalizeLessonContent: a teacher tip alone in its part', () => {
  it('keeps the lesson at two tips and the part valid when the extra tip is its only block', () => {
    const content = coreLessonContent()
    const [labTip] = tips(content)
    section(content, 'launch').parts[0]!.blocks.push({ type: 'teacher_tip', text: 'Tip one.' })
    const action = section(content, 'learning_in_action')
    action.parts.push({
      label: 'C',
      standards: [],
      blocks: [{ type: 'teacher_tip', text: 'Lone tip.' }],
    })
    const partCount = action.parts.length

    const result = normalize(content)

    expect(tips(result)).toHaveLength(MAX_TEACHER_TIPS)
    expect(tips(result)).toEqual(['Tip one.', labTip])
    // The part stays, so labels, standards and minutes are untouched; its text becomes a paragraph.
    const resultAction = section(result, 'learning_in_action')
    expect(resultAction.parts).toHaveLength(partCount)
    expect(resultAction.parts.at(-1)!.blocks).toEqual([
      expect.objectContaining({ type: 'paragraph', text: 'Lone tip.' }),
    ])
    expect(validateLesson(result, { focusStandards: ['RL.6.1'], days: 1 }).ok).toBe(true)
  })

  it('keeps a lone tip that is within the first two', () => {
    const content = coreLessonContent()
    section(content, 'launch').parts.push({
      standards: [],
      blocks: [{ type: 'teacher_tip', text: 'Lone first tip.' }],
    })

    const result = normalize(content)

    expect(tips(result)[0]).toBe('Lone first tip.')
    expect(tips(result).length).toBeLessThanOrEqual(MAX_TEACHER_TIPS)
  })
})
