// R14 "what changed" between two versions (mockup R14-version-history: "Reviewer 07. Edited
// Launch", "Edited Part B, Look Back"). Contract: src/assist/README.md (M4 additions).
import { describe, expect, it } from 'vitest'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import type { LessonContent } from '../lesson/schema'
import { changedAreas } from './version_changes'

function edit(change: (lesson: LessonContent) => void): LessonContent {
  const lesson = richLessonContent()
  change(lesson)
  return lesson
}

function sectionOf(lesson: LessonContent, id: string) {
  const section = lesson.body.sections.find((s) => s.id === id)
  if (!section) throw new Error(`fixture has no ${id}`)
  return section
}

describe('changedAreas (R14)', () => {
  it('is empty for identical content', () => {
    expect(changedAreas(richLessonContent(), richLessonContent())).toEqual([])
  })

  it('names a non-Learning-in-Action section by its name', () => {
    const after = edit((lesson) => {
      const say = sectionOf(lesson, 'sec-launch').parts[0]!.blocks[1]!
      if (say.type !== 'say') throw new Error('fixture changed')
      say.text = 'A new opening line.'
    })
    expect(changedAreas(richLessonContent(), after)).toEqual(['Launch'])
  })

  it('names Learning in Action parts by their label, in lesson order, then later sections', () => {
    const after = edit((lesson) => {
      const reflection = sectionOf(lesson, 'sec-lookback').parts[0]!.blocks[0]!
      if (reflection.type !== 'reflection') throw new Error('fixture changed')
      reflection.prompt = 'Rate yourself from 1 to 3.'
      const rubric = sectionOf(lesson, 'sec-action').parts[1]!.blocks[0]!
      if (rubric.type !== 'rubric') throw new Error('fixture changed')
      rubric.title = 'A new rubric title'
    })
    expect(changedAreas(richLessonContent(), after)).toEqual(['Part B', 'Look Back'])
  })

  it('reports a section-level change (minutes, purpose, parts added) under the section name', () => {
    const after = edit((lesson) => {
      sectionOf(lesson, 'sec-action').purpose = 'A new purpose.'
    })
    expect(changedAreas(richLessonContent(), after)).toEqual(['Learning in Action'])
  })

  it('reports front matter and the other body fields as "Front matter", homework as "Homework"', () => {
    const after = edit((lesson) => {
      lesson.frontMatter.supportingStandards = ['L.6.4']
      lesson.body.homework = { tasks: ['Read pp. 9–15.'] }
    })
    expect(changedAreas(richLessonContent(), after)).toEqual(['Front matter', 'Homework'])
  })

  it('lists each area once', () => {
    const after = edit((lesson) => {
      const launch = sectionOf(lesson, 'sec-launch')
      launch.purpose = 'Changed.'
      const say = launch.parts[0]!.blocks[1]!
      if (say.type !== 'say') throw new Error('fixture changed')
      say.text = 'Changed too.'
    })
    expect(changedAreas(richLessonContent(), after)).toEqual(['Launch'])
  })
})
