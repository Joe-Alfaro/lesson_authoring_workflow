import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../client'
import { standardFramework, standards } from '../schema'

const standardSchema = z
  .looseObject({
    code: z.string().trim().min(1),
    framework: z.enum(standardFramework.enumValues),
    grade: z.number().int(),
    strand: z.string().trim(),
    text: z.string().trim().min(1),
  })
  // Everything beyond the core columns (ELD proficiency levels, outline_code, parent_code...).
  .transform(({ code, framework, grade, strand, text, ...details }) => ({
    code,
    framework,
    grade,
    strand,
    text,
    details,
  }))

const standardsFileSchema = z.array(standardSchema)

export type StandardRecord = z.infer<typeof standardSchema>

/** Reads every `*.json` file in `dir` (array of standards). A missing directory yields none. */
export async function readStandardsDir(dir: string): Promise<StandardRecord[]> {
  const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })
  const files = entries.filter((name) => name.endsWith('.json')).sort()
  const perFile = await Promise.all(
    files.map(async (name) => {
      const path = join(dir, name)
      const parsed = standardsFileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
      if (!parsed.success) {
        throw new Error(`Invalid standards file ${path}: ${z.prettifyError(parsed.error)}`)
      }
      return parsed.data
    }),
  )
  return perFile.flat()
}

/** Upserts standards by code, so loading the same files twice changes nothing. */
export async function upsertStandards(db: Database, records: StandardRecord[]): Promise<number> {
  // Later files win when two files carry the same code; Postgres rejects duplicates in one upsert.
  const byCode = new Map(records.map((record) => [record.code, record]))
  const rows = [...byCode.values()]
  if (rows.length === 0) {
    return 0
  }
  await db
    .insert(standards)
    .values(rows)
    .onConflictDoUpdate({
      target: standards.code,
      set: {
        framework: sql`excluded.framework`,
        grade: sql`excluded.grade`,
        strand: sql`excluded.strand`,
        text: sql`excluded.text`,
        details: sql`excluded.details`,
      },
    })
  return rows.length
}

export async function loadStandards(db: Database, dir: string): Promise<number> {
  return upsertStandards(db, await readStandardsDir(dir))
}
