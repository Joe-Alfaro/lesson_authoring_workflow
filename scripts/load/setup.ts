// Database setup for the load scripts: load-test accounts and a fresh copy of the sample unit,
// imported through the real import service. Needs a migrated and seeded database
// (npm run db:migrate && npm run db:seed): the import is made by author01.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { sql } from 'drizzle-orm'
import type pg from 'pg'
import { createDb, type Database } from '../../src/db/client'
import { users } from '../../src/db/schema'
import { confirmImport, previewImport } from '../../src/import/import_service'
import { assignLessons } from '../../src/workflow/assignment'
import { coreLessonContent } from '../../tests/fixtures/lesson/lesson_fixture'

const SAMPLE_OUTLINE_CSV = resolve(import.meta.dirname, '../../data/sample_unit/lesson_outline.csv')

export interface LoadAccount {
  id: string
  email: string
  name: string
}

export interface ImportedUnit {
  unitId: string
  /** Numbered lessons in outline order. */
  lessons: { id: string; lessonNumber: number }[]
}

async function userId(pool: pg.Pool, email: string): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
  const id = result.rows[0]?.id
  if (!id) throw new Error(`${email} does not exist: run npm run db:seed first`)
  return id
}

/** Upserts `count` reviewer accounts load-reviewer01@example.com ... with this password. */
export async function ensureLoadAccounts(
  pool: pg.Pool,
  count: number,
  password: string,
): Promise<LoadAccount[]> {
  const db: Database = createDb(pool)
  const passwordHash = await bcrypt.hash(password, 10)
  const rows = Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')
    return {
      email: `load-reviewer${number}@example.com`,
      name: `Load Reviewer ${number}`,
      role: 'reviewer' as const,
      passwordHash,
    }
  })
  return db
    .insert(users)
    .values(rows)
    .onConflictDoUpdate({
      target: users.email,
      set: { name: sql`excluded.name`, passwordHash: sql`excluded.password_hash` },
    })
    .returning({ id: users.id, email: users.email, name: users.name })
}

/** Imports data/sample_unit/lesson_outline.csv as a new unit (41 numbered lessons, 6 flex days). */
export async function importSampleUnit(pool: pg.Pool): Promise<ImportedUnit> {
  const db = createDb(pool)
  const authorId = await userId(pool, 'author01@example.com')
  const preview = await previewImport(
    db,
    { kind: 'csv', csv: readFileSync(SAMPLE_OUTLINE_CSV, 'utf8') },
    { userId: authorId },
  )
  const { unitId } = await confirmImport(db, preview.importId, { userId: authorId })
  const result = await pool.query<{ id: string; lesson_number: number }>(
    `SELECT id, lesson_number FROM lessons
     WHERE unit_id = $1 AND lesson_number IS NOT NULL ORDER BY position`,
    [unitId],
  )
  return {
    unitId,
    lessons: result.rows.map((row) => ({ id: row.id, lessonNumber: row.lesson_number })),
  }
}

/**
 * Gives the lessons generated content as Drafts (as the worker leaves them: content plus a
 * generated version), so the editor can open them, and assigns each to its reviewer.
 */
export async function prepareDraftLessons(
  pool: pg.Pool,
  lessons: { id: string; lessonNumber: number; assigneeId: string }[],
): Promise<void> {
  const db = createDb(pool)
  for (const lesson of lessons) {
    const content = coreLessonContent()
    content.body.title = `Load lesson ${lesson.lessonNumber}`
    content.frontMatter.title = content.body.title
    content.frontMatter.number = lesson.lessonNumber
    const json = JSON.stringify(content)
    await pool.query(
      `UPDATE lessons SET content = $2, status = 'draft', updated_at = now() WHERE id = $1`,
      [lesson.id, json],
    )
    await pool.query(
      `INSERT INTO lesson_versions (lesson_id, content, author_id) VALUES ($1, $2, NULL)`,
      [lesson.id, json],
    )
    await assignLessons(db, { lessonIds: [lesson.id], assigneeId: lesson.assigneeId })
  }
}
