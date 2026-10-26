// N1/N4 (M4 re-validation): the content the worker saves (normalizeLessonContent's output) carries
// ids on every section, part and block, so assist can find sections and cite evidence.
import { describe, expect, it } from 'vitest'
import { coreLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'
import { normalizeLessonContent } from './post_process'

describe('generated content ids', () => {
  it('normalizeLessonContent assigns unique ids to a model answer that has none', () => {
    const generated = coreLessonContent()
    expect(generated.body.sections.every((section) => section.id === undefined)).toBe(true)
    const saved = normalizeLessonContent(generated, { pulseCheckCorrectOption: 'B' })
    const all = saved.body.sections.flatMap((section) => [
      section.id,
      ...section.parts.flatMap((part) => [part.id, ...part.blocks.map((block) => block.id)]),
    ])
    expect(all.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(all).size).toBe(all.length)
  })
})
