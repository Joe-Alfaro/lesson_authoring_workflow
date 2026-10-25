import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../../tests/db'
import { runMigrations } from '../migrate'
import { standards, users } from '../schema'
import { seed } from './seed'
import { SEED_USERS } from './users'

const FIXTURE_DIR = resolve(import.meta.dirname, '../../../tests/fixtures/standards')

describe('seed', () => {
  const { pool, db } = connectTestDb()

  beforeAll(async () => {
    await runMigrations(pool)
  })
  afterAll(() => pool.end())

  /** Every standard code in the fixture files, sorted. */
  async function fixtureCodes(): Promise<string[]> {
    const files = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith('.json'))
    const lists = await Promise.all(
      files.map(
        async (file) =>
          JSON.parse(await readFile(join(FIXTURE_DIR, file), 'utf8')) as { code: string }[],
      ),
    )
    return lists
      .flat()
      .map((record) => record.code)
      .sort()
  }

  // Only the seeded accounts: other integration files share this database and add test users.
  async function countByRole() {
    const rows = await db
      .select({ role: users.role, count: sql<number>`count(*)::int` })
      .from(users)
      .where(
        inArray(
          users.email,
          SEED_USERS.map((user) => user.email),
        ),
      )
      .groupBy(users.role)
    return Object.fromEntries(rows.map((row) => [row.role, row.count]))
  }

  it('creates the R27 demo accounts and the standards, and re-running changes nothing', async () => {
    const first = await seed(db, { password: 'first-password', standardsDir: FIXTURE_DIR })
    const second = await seed(db, { password: 'first-password', standardsDir: FIXTURE_DIR })

    expect(first).toEqual({ users: 25, standards: 4 })
    expect(second).toEqual(first)
    expect(await countByRole()).toEqual({ admin: 1, author: 2, approver: 2, reviewer: 20 })
    // Only the fixture's codes (D-029): other integration files load their own standards.
    const codes = await fixtureCodes()
    const seeded = await db
      .select({ code: standards.code })
      .from(standards)
      .where(inArray(standards.code, codes))
    expect(seeded.map((row) => row.code).sort()).toEqual(codes)
    expect(codes).toHaveLength(4)
  })

  it('hashes the seed password and updates it on re-seed', async () => {
    await seed(db, { password: 'old-password', standardsDir: FIXTURE_DIR })
    await seed(db, { password: 'new-password', standardsDir: FIXTURE_DIR })

    const [admin] = await db.select().from(users).where(eq(users.email, 'admin@example.com'))
    expect(admin?.passwordHash).not.toContain('new-password')
    expect(await bcrypt.compare('new-password', admin?.passwordHash ?? '')).toBe(true)
    expect(await bcrypt.compare('old-password', admin?.passwordHash ?? '')).toBe(false)
  })

  it('upserts changed standard text by code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'standards-'))
    await cp(FIXTURE_DIR, dir, { recursive: true })
    const file = join(dir, 'eld_fixture.json')
    const records = JSON.parse(await readFile(file, 'utf8')) as Array<{ text: string }>
    await writeFile(file, JSON.stringify(records.map((r) => ({ ...r, text: 'Updated text.' }))))

    await seed(db, { password: 'pw', standardsDir: dir })

    const [eld] = await db.select().from(standards).where(eq(standards.code, 'ELD.PI.6.6'))
    expect(eld).toEqual({
      code: 'ELD.PI.6.6',
      framework: 'CA_ELD',
      grade: 6,
      strand: 'PI',
      text: 'Updated text.',
      details: {
        strand_name: 'Part I: Interacting in Meaningful Ways',
        emerging: 'Fixture emerging level.',
        expanding: 'Fixture expanding level.',
        bridging: 'Fixture bridging level.',
      },
    })
  })

  it('skips standards when the directory does not exist', async () => {
    const result = await seed(db, { password: 'pw', standardsDir: join(tmpdir(), 'missing-dir-x') })
    expect(result.standards).toBe(0)
  })
})
