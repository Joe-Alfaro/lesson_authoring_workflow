// N1 (M4 re-validation): generated content gets stable ids for every section, part and block when
// it is saved, so lessons.content and the editor's Yjs document share them from the start.
import { describe, expect, it } from 'vitest'
import { coreLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'
import { richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import { withContentIds } from './content_ids'
import { LessonContent } from './schema'

function ids(content: LessonContent): (string | undefined)[] {
  return content.body.sections.flatMap((section) => [
    section.id,
    ...section.parts.flatMap((part) => [part.id, ...part.blocks.map((block) => block.id)]),
  ])
}

/** A lesson the way the model returns it: no ids anywhere. */
function generatedShape(): LessonContent {
  const content = structuredClone(richLessonContent())
  content.body.sections.forEach((section) => {
    delete section.id
    section.parts.forEach((part) => {
      delete part.id
      part.blocks.forEach((block) => delete block.id)
    })
  })
  return content
}

describe('withContentIds', () => {
  it('gives every section, part and block of a generated lesson a unique id', () => {
    const content = withContentIds(generatedShape())
    const all = ids(content)
    expect(all.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(all).size).toBe(all.length)
    expect(LessonContent.safeParse(content).success).toBe(true)
  })

  it('keeps existing ids and changes nothing else', () => {
    const rich = richLessonContent()
    expect(withContentIds(rich)).toEqual(rich)
  })

  it('replaces duplicate ids and is stable once assigned', () => {
    const content = richLessonContent()
    content.body.sections[1]!.parts[0]!.blocks[0]!.id = 'b-say'
    const fixed = withContentIds(content)
    const all = ids(fixed)
    expect(new Set(all).size).toBe(all.length)
    expect(withContentIds(fixed)).toEqual(fixed)
  })

  it('does not change the input', () => {
    const input = generatedShape()
    const copy = structuredClone(input)
    withContentIds(input)
    expect(input).toEqual(copy)
  })

  it('handles the core generation fixture', () => {
    const content = withContentIds(coreLessonContent())
    expect(ids(content).every(Boolean)).toBe(true)
  })
})
