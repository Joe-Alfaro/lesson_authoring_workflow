// R14 "what changed": the areas of a lesson one version changed compared with the one before.
// Contract: src/assist/README.md (M4 additions to src/workflow).
import { isDeepStrictEqual } from 'node:util'
import { SECTION_NAMES } from '../lesson/labels'
import type { LessonContent, Section } from '../lesson/schema'

function sectionAreas(before: Section | undefined, after: Section): string[] {
  if (before && isDeepStrictEqual(before, after)) return []
  const name = SECTION_NAMES[after.kind]
  if (!before || after.kind !== 'learning_in_action' || before.kind !== after.kind) return [name]
  const { parts: beforeParts, ...beforeOwn } = before
  const { parts: afterParts, ...afterOwn } = after
  const sameParts =
    beforeParts.length === afterParts.length &&
    beforeParts.every((part, index) => part.id === afterParts[index]!.id)
  if (!isDeepStrictEqual(beforeOwn, afterOwn) || !sameParts) return [name]
  return afterParts
    .filter((part, index) => !isDeepStrictEqual(part, beforeParts[index]))
    .map((part) => `Part ${part.label || afterParts.indexOf(part) + 1}`)
}

/** Areas in lesson order, each once: Front matter, the sections (LiA by part), Homework. */
export function changedAreas(before: LessonContent, after: LessonContent): string[] {
  const areas: string[] = []
  const { sections: beforeSections, homework: beforeHomework, ...beforeBody } = before.body
  const { sections: afterSections, homework: afterHomework, ...afterBody } = after.body
  if (
    !isDeepStrictEqual(before.frontMatter, after.frontMatter) ||
    !isDeepStrictEqual(beforeBody, afterBody) ||
    before.schemaVersion !== after.schemaVersion
  ) {
    areas.push('Front matter')
  }
  afterSections.forEach((section, index) => {
    const previous =
      beforeSections.find((candidate) => section.id && candidate.id === section.id) ??
      beforeSections[index]
    areas.push(...sectionAreas(previous, section))
  })
  // A section that was removed shows as its own name.
  beforeSections
    .filter((section) => !afterSections.some((candidate) => candidate.id === section.id))
    .forEach((section) => areas.push(SECTION_NAMES[section.kind]))
  if (!isDeepStrictEqual(beforeHomework, afterHomework)) areas.push('Homework')
  return [...new Set(areas)]
}
