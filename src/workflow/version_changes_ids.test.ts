// N3 (M4 re-validation): the first edit of a generated lesson lists only what changed, even when the
// generated version was stored without ids and the edited one has them (lessons saved before ids
// were assigned at generation time).
import { describe, expect, it } from 'vitest'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import type { LessonContent } from '../lesson/schema'
import { changedAreas } from './version_changes'

function withoutIds(content: LessonContent): LessonContent {
  const copy = structuredClone(content)
  copy.body.sections.forEach((section) => {
    delete section.id
    section.parts.forEach((part) => {
      delete part.id
      part.blocks.forEach((block) => delete block.id)
    })
  })
  return copy
}

describe('changedAreas across ids (R14)', () => {
  it('a generated version without ids vs. a first edit in Launch with ids: only Launch', () => {
    const edited = richLessonContent()
    const say = edited.body.sections[0]!.parts[0]!.blocks[1]!
    if (say.type !== 'say') throw new Error('fixture changed')
    say.text = 'A first edit.'
    expect(changedAreas(withoutIds(richLessonContent()), edited)).toEqual(['Launch'])
  })

  it('ids alone are not a change', () => {
    expect(changedAreas(withoutIds(richLessonContent()), richLessonContent())).toEqual([])
  })

  it('a Learning in Action part edit is still named by its label', () => {
    const edited = richLessonContent()
    const rubric = edited.body.sections[2]!.parts[1]!.blocks[0]!
    if (rubric.type !== 'rubric') throw new Error('fixture changed')
    rubric.title = 'New title'
    expect(changedAreas(withoutIds(richLessonContent()), edited)).toEqual(['Part B'])
  })
})
