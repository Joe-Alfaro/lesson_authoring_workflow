// Front-matter standards come only from the reference data (R15, R17): search, add and remove
// chips. Contract: src/editor/README.md.
import type { Node as PmNode } from '@tiptap/pm/model'
import type { Command } from '@tiptap/pm/state'
import type { StandardFramework } from '../db/schema'
import { childrenAt, STRUCTURE_META, type Located } from './commands'
import { lessonSchema, STANDARD_CHIP_NODE, STANDARD_GROUP_NODE } from './schema'

export interface StandardRef {
  code: string
  framework: StandardFramework
  strand: string
  text: string
}

export type StandardGroup = 'focusStandards' | 'supportingStandards' | 'eldStandards'

export const ELD_LEVELS = ['Em', 'Ex', 'Br'] as const

const DEFAULT_LIMIT = 8

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** A code-like query (has a dot or a digit) matches codes; anything else matches words. */
function matchesCode(code: string, query: string): boolean {
  const lower = code.toLowerCase()
  return lower.startsWith(query) || lower.includes(`.${query}`)
}

export function searchStandards(
  reference: StandardRef[],
  query: string,
  options: { exclude?: string[]; limit?: number } = {},
): StandardRef[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const exclude = new Set(options.exclude ?? [])
  const candidates = reference.filter((standard) => !exclude.has(standard.code))
  const byCode = candidates.filter((standard) => matchesCode(standard.code, q))
  const codeLike = /[.\d]/.test(q)
  const queryWords = words(q)
  const byWord = codeLike
    ? []
    : candidates.filter((standard) => {
        if (byCode.includes(standard)) return false
        const own = words(`${standard.strand} ${standard.text}`)
        return queryWords.every((word) => own.some((candidate) => candidate.startsWith(word)))
      })
  return [...byCode, ...byWord].slice(0, options.limit ?? DEFAULT_LIMIT)
}

function groupNode(doc: PmNode, group: StandardGroup): Located | null {
  let found: Located | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === STANDARD_GROUP_NODE && node.attrs.key === group) {
      found = { pos, node }
      return false
    }
    return true
  })
  return found
}

function codesOf(group: Located): string[] {
  return childrenAt(group).map(({ node }) => String(node.attrs.code))
}

export function addStandard(group: StandardGroup, code: string, reference: StandardRef[]): Command {
  return (state, dispatch) => {
    const standard = reference.find((candidate) => candidate.code === code)
    if (!standard) return false
    if ((standard.framework === 'CA_ELD') !== (group === 'eldStandards')) return false
    const target = groupNode(state.doc, group)
    if (!target || codesOf(target).includes(code)) return false
    if (dispatch) {
      const chip = lessonSchema.nodes[STANDARD_CHIP_NODE]!.create({
        code,
        levels: group === 'eldStandards' ? JSON.stringify(ELD_LEVELS) : null,
      })
      const at = target.pos + target.node.nodeSize - 1
      dispatch(state.tr.insert(at, chip).setMeta(STRUCTURE_META, true))
    }
    return true
  }
}

export function removeStandard(group: StandardGroup, code: string): Command {
  return (state, dispatch) => {
    const target = groupNode(state.doc, group)
    if (!target) return false
    const chips = childrenAt(target)
    if (group === 'focusStandards' && chips.length <= 1) return false
    const chip = chips.find(({ node }) => node.attrs.code === code)
    if (!chip) return false
    if (dispatch) {
      dispatch(
        state.tr.delete(chip.pos, chip.pos + chip.node.nodeSize).setMeta(STRUCTURE_META, true),
      )
    }
    return true
  }
}
