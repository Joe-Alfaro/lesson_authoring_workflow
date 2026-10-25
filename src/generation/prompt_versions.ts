// Prompt versions per unit (R10). Contract: src/generation/README.md.
import { asc, desc, eq, max } from 'drizzle-orm'
import type { Database } from '../db/client'
import { promptVersions } from '../db/schema'
import { DEFAULT_PROMPT_TEMPLATE, PromptTemplate } from './prompt_template'

export interface PromptVersion {
  id: string
  unitId: string
  version: number
  template: PromptTemplate
  createdBy: string | null
  createdAt: Date
}

type PromptVersionRow = typeof promptVersions.$inferSelect

function toPromptVersion(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    unitId: row.unitId,
    version: row.version,
    template: PromptTemplate.parse(JSON.parse(row.template)),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getPromptVersion(db: Database, id: string): Promise<PromptVersion | null> {
  if (!UUID.test(id)) {
    return null
  }
  const [row] = await db.select().from(promptVersions).where(eq(promptVersions.id, id))
  return row ? toPromptVersion(row) : null
}

export async function listPromptVersions(db: Database, unitId: string): Promise<PromptVersion[]> {
  const rows = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.unitId, unitId))
    .orderBy(asc(promptVersions.version))
  return rows.map(toPromptVersion)
}

/** The unit's latest version; creates version 1 with the default template if there is none. */
export async function getCurrentPromptVersion(
  db: Database,
  unitId: string,
): Promise<PromptVersion> {
  const [latest] = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.unitId, unitId))
    .orderBy(desc(promptVersions.version))
    .limit(1)
  if (latest) {
    return toPromptVersion(latest)
  }
  // A concurrent caller may create version 1 first; the unique index makes this a no-op then.
  await db
    .insert(promptVersions)
    .values({ unitId, version: 1, template: JSON.stringify(DEFAULT_PROMPT_TEMPLATE) })
    .onConflictDoNothing()
  return getCurrentPromptVersion(db, unitId)
}

export async function savePromptVersion(
  db: Database,
  options: { unitId: string; template: PromptTemplate; userId?: string | null },
): Promise<PromptVersion> {
  const template = PromptTemplate.parse(options.template)
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ version: max(promptVersions.version) })
      .from(promptVersions)
      .where(eq(promptVersions.unitId, options.unitId))
    const [inserted] = await tx
      .insert(promptVersions)
      .values({
        unitId: options.unitId,
        version: (current?.version ?? 0) + 1,
        template: JSON.stringify(template),
        createdBy: options.userId ?? null,
      })
      .returning()
    return inserted!
  })
  return toPromptVersion(row)
}
