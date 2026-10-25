// R17, D-016: the Tiptap/ProseMirror schema is derived from the lesson Zod schema, and lesson JSON
// survives lesson -> ProseMirror doc -> lesson unchanged. Contract: src/editor/README.md.
import { describe, expect, it } from 'vitest'
import { coreLessonContent, flexLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'
import { RICH_FOCUS, richLessonContent } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import { BLOCK_TYPES, validateLesson, type LessonContent } from '../lesson/schema'
import { docToLesson, lessonToDoc } from './convert'
import { blockNodeName, lessonSchema, PART_NODE, SECTION_NODE } from './schema'

type Json = Record<string, unknown>

/** Every node of a ProseMirror JSON doc, depth first. */
function nodesOf(node: Json): Json[] {
  const content = (node.content as Json[] | undefined) ?? []
  return [node, ...content.flatMap(nodesOf)]
}

/** Deep copy without the `id` keys of sections, parts and blocks. */
function withoutIds<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, inner: unknown) => (key === 'id' ? undefined : inner)),
  ) as T
}

function idsOf(lesson: LessonContent): string[] {
  return lesson.body.sections.flatMap((section) => [
    section.id ?? '',
    ...section.parts.flatMap((part) => [
      part.id ?? '',
      ...part.blocks.map((block) => block.id ?? ''),
    ]),
  ])
}

describe('lesson editor schema (derived from the Zod lesson schema)', () => {
  it('has one node type per lesson block type, and no other lesson block nodes', () => {
    const blockNodes = Object.values(lessonSchema.nodes)
      .filter((type) => (type.spec.group ?? '').split(' ').includes('lessonBlock'))
      .map((type) => type.name)
      .sort()
    expect(blockNodes).toEqual(BLOCK_TYPES.map(blockNodeName).sort())
  })

  it('names block nodes one to one with the block types', () => {
    const names = BLOCK_TYPES.map(blockNodeName)
    expect(new Set(names).size).toBe(BLOCK_TYPES.length)
    BLOCK_TYPES.forEach((type) => expect(lessonSchema.nodes[blockNodeName(type)]).toBeDefined())
  })

  it('has section and part nodes and only the bold and italic marks', () => {
    expect(lessonSchema.nodes[SECTION_NODE]).toBeDefined()
    expect(lessonSchema.nodes[PART_NODE]).toBeDefined()
    expect(Object.keys(lessonSchema.marks).sort()).toEqual(['bold', 'italic'])
  })

  it('gives block, part and section nodes an id attribute', () => {
    ;[SECTION_NODE, PART_NODE, ...BLOCK_TYPES.map(blockNodeName)].forEach((name) =>
      expect(Object.keys(lessonSchema.nodes[name]!.spec.attrs ?? {})).toContain('id'),
    )
  })
})

describe('lessonToDoc and docToLesson', () => {
  it('the rich fixture is a valid lesson that uses every block type', () => {
    const lesson = richLessonContent()
    expect(validateLesson(lesson, { focusStandards: RICH_FOCUS, days: 1 }).ok).toBe(true)
    const used = new Set(
      lesson.body.sections.flatMap((s) => s.parts.flatMap((p) => p.blocks.map((b) => b.type))),
    )
    expect([...used].sort()).toEqual([...BLOCK_TYPES].sort())
  })

  it('produces a ProseMirror doc that is valid in the lesson schema', () => {
    const doc = lessonSchema.nodeFromJSON(lessonToDoc(richLessonContent()))
    expect(() => doc.check()).not.toThrow()
    expect(doc.type.name).toBe('doc')
  })

  it('holds one node per section, part and block, in order and with their ids', () => {
    const lesson = richLessonContent()
    const nodes = nodesOf(lessonToDoc(lesson) as Json)
    const byName = (name: string) =>
      nodes.filter((node) => node.type === name).map((node) => (node.attrs as Json).id)
    expect(byName(SECTION_NODE)).toEqual(lesson.body.sections.map((s) => s.id))
    expect(byName(PART_NODE)).toEqual(lesson.body.sections.flatMap((s) => s.parts.map((p) => p.id)))
    expect(byName(blockNodeName('ask'))).toEqual(['b-ask'])
    expect(byName(blockNodeName('pulse_check'))).toEqual(['b-pulse'])
  })

  it('turns **bold** and *italic* into marks, not literal asterisks', () => {
    const texts = nodesOf(lessonToDoc(richLessonContent()) as Json).filter((n) => n.type === 'text')
    const marked = (mark: string) =>
      texts
        .filter((n) => ((n.marks as Json[] | undefined) ?? []).some((m) => m.type === mark))
        .map((n) => n.text)
    expect(marked('bold')).toContain('one detail')
    expect(marked('bold')).toContain('not')
    expect(marked('italic')).toContain('problem kid')
    expect(texts.some((n) => String(n.text).includes('*'))).toBe(false)
  })

  it('round-trips the rich fixture losslessly (every block type and optional field)', () => {
    const lesson = richLessonContent()
    const result = docToLesson(lessonToDoc(lesson))
    expect(result).toEqual({ ok: true, lesson })
  })

  it('round-trips through the schema node too (as the editor and Yjs hold it)', () => {
    const lesson = richLessonContent()
    const node = lessonSchema.nodeFromJSON(lessonToDoc(lesson))
    expect(docToLesson(node.toJSON())).toEqual({ ok: true, lesson })
  })

  it.each([
    ['core lesson', coreLessonContent],
    ['flex day (null number, no homework)', flexLessonContent],
  ])('round-trips the %s fixture, adding unique ids where the input had none', (_, build) => {
    const lesson = build()
    const result = docToLesson(lessonToDoc(lesson))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(withoutIds(result.lesson)).toEqual(withoutIds(lesson))
    const ids = idsOf(result.lesson)
    expect(ids.every((id) => id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps empty strings, empty arrays and absent optional fields apart', () => {
    const lesson = richLessonContent()
    lesson.frontMatter.supportingStandards = []
    lesson.frontMatter.eldStandards = []
    lesson.body.vocabulary.support = []
    lesson.body.materials = []
    delete lesson.body.objectives.foundationalSkills
    lesson.body.homework = null
    const result = docToLesson(lessonToDoc(lesson))
    expect(result).toEqual({ ok: true, lesson })
    if (result.ok) {
      expect('foundationalSkills' in result.lesson.body.objectives).toBe(false)
    }
  })

  it('reports schema errors (not a throw) for a doc that no longer validates', () => {
    const doc = lessonToDoc(richLessonContent()) as Json
    // Empty the say block: a say block needs text.
    const say = nodesOf(doc).find(
      (n) => n.type === blockNodeName('say') && (n.attrs as Json).id === 'b-say',
    )!
    const clear = (node: Json): void => {
      node.content = ((node.content as Json[] | undefined) ?? []).filter(
        (child) => child.type !== 'text',
      )
      ;(node.content as Json[]).forEach(clear)
    }
    clear(say)
    const result = docToLesson(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ code: 'schema' })
      expect(result.errors.map((e) => e.path)).toContain('body.sections.0.parts.0.blocks.1.text')
    }
  })
})
