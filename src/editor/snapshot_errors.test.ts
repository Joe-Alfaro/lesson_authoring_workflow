// Validation fix (M3, R17): when the lesson can't be saved, the editor names the field that
// blocks saving and can put the caret there.
import { describe, expect, it } from 'vitest'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import { addBlock } from './commands'
import { createLessonState, stateToLesson } from './state'
import { describeBlockingField } from './snapshot_errors'

describe('describeBlockingField', () => {
  it('names an empty new block by section and block label, with its position', () => {
    const start = createLessonState(richLessonContent())
    let state = start
    addBlock('b-say', 'say')(start, (tr) => {
      state = start.apply(tr)
    })
    const result = stateToLesson(state)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const field = describeBlockingField(state.doc, result.errors)
    expect(field?.label).toBe('Launch: Say is empty')
    expect(state.doc.resolve(field!.pos).parent.isTextblock).toBe(true)
    expect(state.doc.resolve(field!.pos).parent.textContent).toBe('')
  })

  it('names an empty list item and an empty body field', () => {
    const lesson = richLessonContent()
    lesson.body.materials = ['Anchor text', '']
    lesson.body.objectives.content = ''
    // Built straight from JSON: the editor allows empty fields mid-edit.
    const state = createLessonState(lesson as never)
    const result = stateToLesson(state)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const labels = result.errors.map((error) => describeBlockingField(state.doc, [error])?.label)
    expect(labels).toContain('Objectives: Content is empty')
    expect(labels).toContain('Materials: item 2 is empty')
  })
})
