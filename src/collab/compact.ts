// Keeps stored lesson docs near their content size. @tiptap/y-tiptap 3.0.10 wrote a "position
// migration" record into a `__tiptap_position_migrations:*` map on every structural edit (~1.5 MB
// each, never pruned); the editor now pins 3.0.9, which has no such records, and the server drops
// any that exist. Deleting map entries keeps every lesson item and its id, so a client holding the
// old doc still merges cleanly; garbage collection turns the deleted records into a few bytes.
import * as Y from 'yjs'

const MIGRATION_PREFIX = '__tiptap_position_migrations:'

/** Origin of the compaction transaction (not an edit: no last editor, no idle version). */
export const COMPACT_ORIGIN = { source: 'local' as const, skipStoreHooks: true }

/** Deletes position migration records; true when there were any. */
export function compactLessonDoc(doc: Y.Doc): boolean {
  const maps = [...doc.share.keys()]
    .filter((name) => name.startsWith(MIGRATION_PREFIX))
    .map((name) => doc.getMap(name))
    .filter((map) => map.size > 0)
  if (maps.length === 0) return false
  doc.transact(() => {
    maps.forEach((map) => [...map.keys()].forEach((key) => map.delete(key)))
  }, COMPACT_ORIGIN)
  return true
}

/** Stored state may be this many times the lesson JSON (Yjs ids and text runs) before a rebuild. */
const MAX_STATE_RATIO = 8
const MIN_REBUILD_BYTES = 256 * 1024

/**
 * True when the doc's state is far larger than its lesson even after compaction (thousands of
 * tombstones from y-tiptap 3.0.10). The server then rebuilds the doc from the lesson once.
 */
export function isBloated(doc: Y.Doc, content: unknown): boolean {
  const state = Y.encodeStateAsUpdate(doc).byteLength
  const json = JSON.stringify(content ?? null).length
  return state > MIN_REBUILD_BYTES && state > json * MAX_STATE_RATIO
}
