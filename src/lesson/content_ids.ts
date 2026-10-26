// Stable ids for every section, part and block (N1 of the M4 re-validation). The model returns
// lessons without ids; generation saves them with ids so lessons.content, the versions and the
// editor's Yjs document all name the same sections, parts and blocks from the start.
import type { LessonContent } from './schema'

/** A copy of `content` where every section, part and block has a unique id; existing ids stay. */
export function withContentIds(content: LessonContent): LessonContent {
  const copy = structuredClone(content)
  const used = new Set<string>()
  const keep = (id: string | undefined): string => {
    const next = id && !used.has(id) ? id : globalThis.crypto.randomUUID()
    used.add(next)
    return next
  }
  copy.body.sections.forEach((section) => {
    section.id = keep(section.id)
    section.parts.forEach((part) => {
      part.id = keep(part.id)
      part.blocks.forEach((block) => {
        block.id = keep(block.id)
      })
    })
  })
  return copy
}

/** True when every section, part and block already has a unique id. */
export function hasContentIds(content: LessonContent): boolean {
  const ids = content.body.sections.flatMap((section) => [
    section.id,
    ...section.parts.flatMap((part) => [part.id, ...part.blocks.map((block) => block.id)]),
  ])
  return ids.every(Boolean) && new Set(ids).size === ids.length
}
