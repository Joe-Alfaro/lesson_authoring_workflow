// Helpers for the unit dashboard (R9-R12, R24, R25) and prompt editor (R10) specs: import the
// sample unit, put it in a mockup state directly in the database, and read the page the way a
// user does. Generation states are written the way the worker writes them, including the
// Postgres NOTIFY that drives live progress, so no model and no worker are needed for them.
import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import pg from 'pg'
import { createDb, type Database } from '../../src/db/client'
import {
  computeCostUsd,
  DEFAULT_MODEL,
  ESTIMATED_TOKENS_PER_LESSON,
} from '../../src/generation/llm'
import { notifyLessonProgress } from '../../src/generation/progress'
import { getCurrentPromptVersion, savePromptVersion } from '../../src/generation/prompt_versions'
import { DEFAULT_PROMPT_TEMPLATE } from '../../src/generation/prompt_template'
import { confirmImport, previewImport } from '../../src/import/import_service'
import { coreLessonContent } from '../fixtures/lesson/lesson_fixture'
import { SAMPLE_OUTLINE_CSV, expect, test as base } from './support'

export { expect }

/** The e2e test with `dash`: the database helpers for these specs, after the usual reset. */
export const test = base.extend<{ dash: DashboardDb }>({
  dash: async ({ db, pool }, provide) => {
    expect(await db.count('units')).toBe(0)
    const dash = new DashboardDb(pool)
    await dash.clearQueuedGeneration()
    await provide(dash)
  },
})

export const ADMIN = { email: 'admin@example.com', name: 'Admin', role: 'Admin' }
export const APPROVER = { email: 'approver01@example.com', name: 'Approver 01', role: 'Approver' }

export function reviewer(n: number) {
  const number = String(n).padStart(2, '0')
  return { email: `reviewer${number}@example.com`, name: `Reviewer ${number}`, role: 'Reviewer' }
}

/** Cost of one lesson in these tests: the estimate's tokens at the Haiku-class price. */
export const LESSON_COST_USD = computeCostUsd(DEFAULT_MODEL, ESTIMATED_TOKENS_PER_LESSON)

/** "$0.51": how the dashboard shows money (D-027: real values, never placeholders). */
export function usd(value: number): string {
  return `$${value.toFixed(2)}`
}

export type JobStatus = 'queued' | 'generating' | 'generated' | 'failed' | 'cancelled'
export type LessonStatus =
  'generating' | 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'failed'

export interface SampleUnit {
  unitId: string
  /** "Unit 4: <anchor text>", the unit's h1. */
  heading: string
  /** Lesson id by lesson number (1-41). */
  lessonIds: Map<number, string>
  flexLessonIds: string[]
  /** First line of each lesson's outline description, by lesson number. */
  outlineLines: Map<number, string>
  arcNames: string[]
}

export class DashboardDb {
  readonly db: Database

  constructor(readonly pool: pg.Pool) {
    this.db = createDb(pool)
  }

  async userId(email: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      email,
    ])
    return result.rows[0]!.id
  }

  /** Removes generation jobs left in pg-boss by an earlier test (their rows are gone). */
  async clearQueuedGeneration(): Promise<void> {
    await this.pool
      .query(`DELETE FROM pgboss.job WHERE name = 'generate-lesson'`)
      .catch(() => undefined)
  }

  /** Imports data/sample_unit/lesson_outline.csv through the real import service (41 lessons). */
  async importSampleUnit(): Promise<SampleUnit> {
    const authorId = await this.userId('author01@example.com')
    const preview = await previewImport(
      this.db,
      { kind: 'csv', csv: readFileSync(SAMPLE_OUTLINE_CSV, 'utf8') },
      { userId: authorId },
    )
    const { unitId } = await confirmImport(this.db, preview.importId, { userId: authorId })
    const unit = await this.pool.query<{ unit_number: number; anchor_text_title: string }>(
      'SELECT unit_number, anchor_text_title FROM units WHERE id = $1',
      [unitId],
    )
    const lessons = await this.pool.query<{
      id: string
      lesson_number: number | null
      description: string
    }>('SELECT id, lesson_number, description FROM lessons WHERE unit_id = $1 ORDER BY position', [
      unitId,
    ])
    const arcs = await this.pool.query<{ name: string }>(
      'SELECT name FROM arcs WHERE unit_id = $1 ORDER BY position',
      [unitId],
    )
    const lessonIds = new Map<number, string>()
    const outlineLines = new Map<number, string>()
    const flexLessonIds: string[] = []
    lessons.rows.forEach((row) => {
      if (row.lesson_number === null) {
        flexLessonIds.push(row.id)
        return
      }
      lessonIds.set(row.lesson_number, row.id)
      outlineLines.set(row.lesson_number, row.description.split('\n')[0]!.trim())
    })
    const { unit_number: unitNumber, anchor_text_title: title } = unit.rows[0]!
    return {
      unitId,
      heading: `Unit ${unitNumber}: ${title}`,
      lessonIds,
      flexLessonIds,
      outlineLines,
      arcNames: arcs.rows.map((row) => row.name),
    }
  }

  /** The unit's current prompt version (creates v1 from the default template when none). */
  async currentPromptVersion(unitId: string) {
    return getCurrentPromptVersion(this.db, unitId)
  }

  /** Saves the next prompt version, as the prompt editor would. */
  async savePromptVersion(unitId: string, system: string, userEmail = 'author01@example.com') {
    return savePromptVersion(this.db, {
      unitId,
      template: { ...DEFAULT_PROMPT_TEMPLATE, system },
      userId: await this.userId(userEmail),
    })
  }

  async createRun(
    unitId: string,
    options: {
      status: 'queued' | 'running' | 'completed' | 'cancelled' | 'stopped_cap'
      costUsd: number
      capUsd: number
      promptVersionId?: string
      createdBy?: string
      finished?: boolean
    },
  ): Promise<string> {
    const promptVersionId = options.promptVersionId ?? (await this.currentPromptVersion(unitId)).id
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO generation_runs (unit_id, model, prompt_version_id, cap_usd, cost_usd, status, created_by, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() ELSE NULL END) RETURNING id`,
      [
        unitId,
        DEFAULT_MODEL,
        promptVersionId,
        options.capUsd,
        options.costUsd,
        options.status,
        options.createdBy ?? (await this.userId('author01@example.com')),
        options.finished ?? false,
      ],
    )
    return result.rows[0]!.id
  }

  /**
   * Writes one lesson's generation job and the lesson row the way the worker leaves them:
   * generated lessons get content (titled `seededTitle(n)`) and a generated version.
   */
  async setJob(
    unit: SampleUnit,
    runId: string,
    lessonNumber: number,
    status: JobStatus,
    options: { error?: string; lessonStatus?: LessonStatus } = {},
  ): Promise<void> {
    const lessonId = unit.lessonIds.get(lessonNumber)!
    const cost = status === 'generated' || status === 'failed' ? LESSON_COST_USD : 0
    const tokens = cost > 0 ? ESTIMATED_TOKENS_PER_LESSON : { inputTokens: 0, outputTokens: 0 }
    await this.pool.query(
      `INSERT INTO generation_jobs (run_id, lesson_id, status, attempts, error, tokens_in, tokens_out, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (run_id, lesson_id) DO UPDATE SET status = excluded.status, attempts = excluded.attempts,
         error = excluded.error, tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out,
         cost_usd = excluded.cost_usd, updated_at = now()`,
      [
        runId,
        lessonId,
        status,
        status === 'queued' ? 0 : status === 'failed' ? 2 : 1,
        options.error ?? null,
        tokens.inputTokens,
        tokens.outputTokens,
        cost,
      ],
    )
    if (status === 'generated') {
      const content = generatedContent(lessonNumber)
      await this.pool.query(
        `UPDATE lessons SET content = $2, status = $3, updated_at = now() WHERE id = $1`,
        [lessonId, JSON.stringify(content), options.lessonStatus ?? 'draft'],
      )
      await this.pool.query(
        `INSERT INTO lesson_versions (lesson_id, content, author_id) VALUES ($1, $2, NULL)`,
        [lessonId, JSON.stringify(content)],
      )
    } else if (status === 'generating' || status === 'failed') {
      await this.pool.query(`UPDATE lessons SET status = $2, updated_at = now() WHERE id = $1`, [
        lessonId,
        status,
      ])
    }
    await notifyLessonProgress(this.db, { unitId: unit.unitId, lessonId, lessonNumber, status })
  }

  async setRun(runId: string, fields: { costUsd?: number; status?: string }): Promise<void> {
    if (fields.costUsd !== undefined) {
      await this.pool.query('UPDATE generation_runs SET cost_usd = $2 WHERE id = $1', [
        runId,
        fields.costUsd,
      ])
    }
    if (fields.status !== undefined) {
      await this.pool.query('UPDATE generation_runs SET status = $2 WHERE id = $1', [
        runId,
        fields.status,
      ])
    }
  }

  async setLesson(
    unit: SampleUnit,
    lessonNumber: number,
    fields: {
      status?: LessonStatus
      assigneeEmail?: string | null
      lastEditorEmail?: string | null
      textDependentQuestion?: string
    },
  ): Promise<void> {
    const lessonId = unit.lessonIds.get(lessonNumber)!
    if (fields.status !== undefined) {
      await this.pool.query('UPDATE lessons SET status = $2 WHERE id = $1', [
        lessonId,
        fields.status,
      ])
    }
    if (fields.assigneeEmail !== undefined) {
      const id = fields.assigneeEmail ? await this.userId(fields.assigneeEmail) : null
      await this.pool.query('UPDATE lessons SET assignee_id = $2 WHERE id = $1', [lessonId, id])
    }
    if (fields.lastEditorEmail !== undefined) {
      const id = fields.lastEditorEmail ? await this.userId(fields.lastEditorEmail) : null
      await this.pool.query('UPDATE lessons SET last_edited_by = $2 WHERE id = $1', [lessonId, id])
    }
    if (fields.textDependentQuestion !== undefined) {
      await this.pool.query('UPDATE lessons SET text_dependent_question = $2 WHERE id = $1', [
        lessonId,
        fields.textDependentQuestion,
      ])
    }
  }

  async lessonRow(unit: SampleUnit, lessonNumber: number) {
    const result = await this.pool.query<{
      status: LessonStatus
      assignee_id: string | null
      content: { body?: { title?: string } } | null
    }>('SELECT status, assignee_id, content FROM lessons WHERE id = $1', [
      unit.lessonIds.get(lessonNumber),
    ])
    return result.rows[0]!
  }

  async versionCount(unit: SampleUnit, lessonNumber: number): Promise<number> {
    const result = await this.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM lesson_versions WHERE lesson_id = $1',
      [unit.lessonIds.get(lessonNumber)],
    )
    return Number(result.rows[0]!.n)
  }

  async runs(unitId: string) {
    const result = await this.pool.query<{
      id: string
      status: string
      cap_usd: string
      cost_usd: string
      model: string
    }>(
      'SELECT id, status, cap_usd::text, cost_usd::text, model FROM generation_runs WHERE unit_id = $1 ORDER BY created_at',
      [unitId],
    )
    return result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      capUsd: Number(row.cap_usd),
      costUsd: Number(row.cost_usd),
      model: row.model,
    }))
  }

  /** Latest job status per lesson number for the unit. */
  async jobStatuses(unit: SampleUnit): Promise<Map<number, JobStatus>> {
    const result = await this.pool.query<{ lesson_number: number; status: JobStatus }>(
      `SELECT DISTINCT ON (j.lesson_id) l.lesson_number, j.status
       FROM generation_jobs j JOIN lessons l ON l.id = j.lesson_id
       WHERE l.unit_id = $1 AND l.lesson_number IS NOT NULL
       ORDER BY j.lesson_id, j.created_at DESC`,
      [unit.unitId],
    )
    return new Map(result.rows.map((row) => [row.lesson_number, row.status]))
  }

  async promptVersions(unitId: string) {
    const result = await this.pool.query<{ version: number; template: string }>(
      'SELECT version, template FROM prompt_versions WHERE unit_id = $1 ORDER BY version',
      [unitId],
    )
    return result.rows
  }
}

/**
 * Title of a lesson generated by a seeded state. It differs from `generatedTitle` (the e2e fake
 * LLM's), so a test can tell a regenerated lesson from the seeded one.
 */
export function seededTitle(lessonNumber: number): string {
  return `Seeded title for lesson ${lessonNumber}`
}

/** Valid lesson content as a seeded generation leaves it. */
export function generatedContent(lessonNumber: number): unknown {
  const content = coreLessonContent()
  content.body.title = seededTitle(lessonNumber)
  content.frontMatter.title = seededTitle(lessonNumber)
  content.frontMatter.number = lessonNumber
  return content
}

/** Lesson numbers from `from` to `to`, inclusive. */
export function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

// ---- Mockup states ---------------------------------------------------------------------------

/**
 * R9-dashboard-generating: 15 generated (Draft), lessons 9 and 14 failed, 18-21 generating,
 * 22-41 queued. Returns the run id.
 */
export const GENERATING_ERROR =
  'Section minutes add up to 55, but the lesson must take exactly 50 minutes (50 x 1 day).'

export async function seedGeneratingState(db: DashboardDb, unit: SampleUnit): Promise<string> {
  const generated = [...range(1, 8), ...range(10, 13), ...range(15, 17)]
  const runId = await db.createRun(unit.unitId, {
    status: 'running',
    capUsd: 5,
    costUsd: (generated.length + 2) * LESSON_COST_USD,
  })
  for (const n of generated) {
    await db.setJob(unit, runId, n, 'generated')
  }
  for (const n of [9, 14]) {
    await db.setJob(unit, runId, n, 'failed', { error: GENERATING_ERROR })
  }
  for (const n of range(18, 21)) {
    await db.setJob(unit, runId, n, 'generating')
  }
  for (const n of range(22, 41)) {
    await db.setJob(unit, runId, n, 'queued')
  }
  return runId
}

/** Cost and cap of the R12-dashboard-spend-cap state: the run overshot its cap slightly. */
export const STOPPED_RUN = { capUsd: 0.25, costUsd: 0.29 }

/**
 * R12-dashboard-spend-cap: 23 generated, lesson 14 failed, 25-41 cancelled by the spend guard,
 * run status stopped_cap.
 */
export async function seedSpendCapState(db: DashboardDb, unit: SampleUnit): Promise<string> {
  const runId = await db.createRun(unit.unitId, {
    status: 'stopped_cap',
    ...STOPPED_RUN,
    finished: true,
  })
  for (const n of [...range(1, 13), ...range(15, 24)]) {
    await db.setJob(unit, runId, n, 'generated')
  }
  await db.setJob(unit, runId, 14, 'failed', { error: GENERATING_ERROR })
  for (const n of range(25, 41)) {
    await db.setJob(unit, runId, n, 'cancelled')
  }
  return runId
}

/** Reviewer number assigned to each lesson in the review state (lessons not listed: none). */
export const REVIEW_ASSIGNEES: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 1,
  10: 2,
  11: 4,
  12: 5,
  13: 6,
  14: 7,
  15: 3,
  16: 8,
  19: 3,
}

/** Status of each lesson in the review state: 5 approved, 9 in review, 2 changes, 1 failed. */
export function reviewStatus(n: number): LessonStatus {
  if (n <= 5) return 'approved'
  if (n <= 14) return 'in_review'
  if (n <= 16) return 'changes_requested'
  if (n === 17) return 'failed'
  return 'draft'
}

/**
 * R24-dashboard-review: a completed run, then review progress: Draft 24, In review 9, Changes
 * requested 2, Approved 5, Failed 1, with assignees (REVIEW_ASSIGNEES) and last editors.
 */
export async function seedReviewState(db: DashboardDb, unit: SampleUnit): Promise<string> {
  const runId = await db.createRun(unit.unitId, {
    status: 'completed',
    capUsd: 5,
    costUsd: 41 * LESSON_COST_USD,
    finished: true,
  })
  for (const n of range(1, 41)) {
    if (reviewStatus(n) === 'failed') {
      await db.setJob(unit, runId, n, 'failed', { error: GENERATING_ERROR })
    } else {
      await db.setJob(unit, runId, n, 'generated', { lessonStatus: reviewStatus(n) })
    }
  }
  for (const [n, r] of Object.entries(REVIEW_ASSIGNEES)) {
    const number = Number(n)
    await db.setLesson(unit, number, {
      assigneeEmail: reviewer(r).email,
      lastEditorEmail: reviewStatus(number) === 'approved' ? APPROVER.email : reviewer(r).email,
    })
  }
  return runId
}

/** Every numbered lesson generated and approved (flex days untouched, D-030). */
export async function seedCompleteState(db: DashboardDb, unit: SampleUnit): Promise<void> {
  const runId = await db.createRun(unit.unitId, {
    status: 'completed',
    capUsd: 5,
    costUsd: 41 * LESSON_COST_USD,
    finished: true,
  })
  for (const n of range(1, 41)) {
    await db.setJob(unit, runId, n, 'generated', { lessonStatus: 'approved' })
  }
}

// ---- Page helpers ----------------------------------------------------------------------------

export async function openUnit(page: Page, unit: SampleUnit): Promise<void> {
  await page.goto(`/units/${unit.unitId}`)
  await expect(page.getByRole('heading', { level: 1, name: unit.heading })).toBeVisible()
}

/** The table row of a numbered lesson, found by its "Select lesson N" checkbox. */
export function lessonRow(page: Page | Locator, lessonNumber: number): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('checkbox', { name: `Select lesson ${lessonNumber}`, exact: true }),
  })
}

/** Every visible numbered-lesson row of the lesson table. */
export function lessonRows(page: Page): Locator {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('checkbox', { name: /^Select lesson \d+$/ }) })
}

/** The unit strip tile of a lesson ("Lesson 17, Draft"). */
export function tile(page: Page | Locator, lessonNumber: number, status: string): Locator {
  return page.getByRole('img', { name: `Lesson ${lessonNumber}, ${status}`, exact: true })
}

/** The value next to a term in a description list (the cost panel and the start dialog). */
export function termValue(scope: Page | Locator, term: string): Locator {
  return scope
    .getByRole('term')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(term)}\\s*$`) })
    .locator('xpath=following-sibling::*[1]')
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Marks the document so a test can prove the page was never reloaded. */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { __e2eNoReload: boolean }).__e2eNoReload = true
  })
}

export async function expectSameDocument(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload),
  ).toBe(true)
}

/** R9: live changes must show within 5 s of the status change. */
export const LIVE_UPDATE_MS = 5_000
