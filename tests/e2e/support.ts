import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type Page, type TestInfo } from '@playwright/test'
import pg from 'pg'
import { E2E_SEED_PASSWORD, E2E_STATE_FILE, type E2eState } from './env'

const ROOT = resolve(import.meta.dirname, '../..')

export const SAMPLE_OUTLINE_CSV = resolve(ROOT, 'data/sample_unit/lesson_outline.csv')
export const SAMPLE_ELD_CSV = resolve(ROOT, 'data/sample_unit/eld_scope_and_sequence.csv')

/**
 * A link to a sheet that doesn't exist. Google answers it with an error or its sign-in page, and
 * an unreachable Google is reported the same way, so the R1 "must be shared by link" error is
 * deterministic with or without network access.
 */
export const PRIVATE_SHEET_LINK =
  'https://docs.google.com/spreadsheets/d/e2e-private-sheet-that-does-not-exist/edit'

export const AUTHOR = { email: 'author01@example.com', name: 'Author 01', role: 'Author' }

/** Direct access to the e2e database for resetting state and checking what was saved. */
export class E2eDb {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Removes everything an import or an editor creates; seeded users and standards stay. A late
   * collab store from the previous test (lessons row, then yjs_documents) can deadlock with the
   * TRUNCATE, which locks the tables in the other order; Postgres then aborts one side (40P01),
   * so the reset retries.
   */
  async resetImports(): Promise<void> {
    const attempts = 3
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.pool.query(
          'TRUNCATE units, pending_imports, yjs_documents RESTART IDENTITY CASCADE',
        )
        return
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== '40P01' || attempt >= attempts) throw error
        console.warn(`[e2e] reset deadlocked with a late app write; retry ${attempt}`)
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
      }
    }
  }

  async count(table: 'units' | 'pending_imports' | 'arcs'): Promise<number> {
    const result = await this.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)
    return Number(result.rows[0]?.n ?? 0)
  }

  async lessonCounts(): Promise<{ lessons: number; flexDays: number }> {
    const result = await this.pool.query<{ lessons: string; flex: string }>(
      `SELECT count(*) FILTER (WHERE NOT is_flex)::text AS lessons,
              count(*) FILTER (WHERE is_flex)::text AS flex
       FROM lessons`,
    )
    const row = result.rows[0]
    return { lessons: Number(row?.lessons ?? 0), flexDays: Number(row?.flex ?? 0) }
  }
}

function readState(): E2eState {
  return JSON.parse(readFileSync(E2E_STATE_FILE, 'utf8')) as E2eState
}

export const test = base.extend<{ db: E2eDb }, { pool: pg.Pool }>({
  pool: [
    async ({}, provide) => {
      const pool = new pg.Pool({ connectionString: readState().databaseUrl })
      await provide(pool)
      await pool.end()
    },
    { scope: 'worker' },
  ],
  db: async ({ pool }, provide) => {
    const db = new E2eDb(pool)
    await db.resetImports()
    await provide(db)
  },
})

export { expect }

/** Signs in through the R27 form and waits until the app has left the sign-in page. */
export async function signIn(page: Page, email = AUTHOR.email, password = E2E_SEED_PASSWORD) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
}

/**
 * Saves a full-page screenshot of a mockup state as test-results/screens/<state>.png for the
 * validator to compare with docs/design/lesson-authoring/<state>.png by eye. No pixel diff.
 */
export async function snap(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  const path = join(testInfo.project.outputDir, 'screens', `${state}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(state, { path, contentType: 'image/png' })
}

/** Asserts axe finds no WCAG 2.1 A/AA violations on the page as it is now. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
}

/** The "Import an outline" call to action on the Units page (a link in the mockup). */
export function importOutlineAction(page: Page) {
  const name = 'Import an outline'
  return page.getByRole('link', { name }).or(page.getByRole('button', { name }))
}

/** Opens the import form from the empty Units page the way an author would. */
export async function openImportForm(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Units' }).click()
  await importOutlineAction(page).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Import an outline' })).toBeVisible()
}
