import { afterAll, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import { runMigrations } from './migrate'

const EXPECTED_TABLES = [
  'arcs',
  'generation_jobs',
  'generation_runs',
  'lesson_standards',
  'lesson_versions',
  'lessons',
  'prompt_versions',
  'standards',
  'units',
  'users',
  'workflow_events',
  'yjs_documents',
]

describe('runMigrations', () => {
  const { pool } = connectTestDb()
  afterAll(() => pool.end())

  it('creates every R14 table and is safe to run twice', async () => {
    await runMigrations(pool)
    await runMigrations(pool)

    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    )
    expect(rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES)
  })

  it('stores the lesson statuses from R23', async () => {
    await runMigrations(pool)
    const { rows } = await pool.query<{ value: string }>(
      `select unnest(enum_range(null::lesson_status))::text as value`,
    )
    expect(rows.map((row) => row.value)).toEqual([
      'generating',
      'draft',
      'in_review',
      'changes_requested',
      'approved',
      'failed',
    ])
  })
})
