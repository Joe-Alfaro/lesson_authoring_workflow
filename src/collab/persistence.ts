import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import { yjsDocuments } from '../db/schema'

export interface YjsPersistence {
  fetch(name: string): Promise<Uint8Array | null>
  store(name: string, state: Uint8Array): Promise<void>
}

/** Stores each Yjs document's full encoded state in yjs_documents, keyed by document name. */
export function createYjsPersistence(db: Database): YjsPersistence {
  return {
    async fetch(name) {
      const [row] = await db
        .select({ state: yjsDocuments.state })
        .from(yjsDocuments)
        .where(eq(yjsDocuments.name, name))
      return row?.state ?? null
    },
    async store(name, state) {
      await db
        .insert(yjsDocuments)
        .values({ name, state })
        .onConflictDoUpdate({
          target: yjsDocuments.name,
          set: { state: sql`excluded.state`, updatedAt: sql`now()` },
        })
    },
  }
}
