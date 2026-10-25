// Helpers for the M4 specs (AI assist, workflow bar, version changes). The model is the fake
// Anthropic API that server.ts starts (fake_anthropic.ts); specs script its answers here.
// Contract: src/assist/README.md.
import type { Page } from '@playwright/test'
import type pg from 'pg'
import { E2E_FAKE_LLM_URL } from './env'
import type { FakeRequest, FakeResponse } from './fake_anthropic'
import { editorOf } from './lesson_support'

export const fakeLlm = {
  async reset(): Promise<void> {
    await fetch(`${E2E_FAKE_LLM_URL}/__fake/reset`, { method: 'POST' })
  },
  /** Queues answers; each model call takes the next one. */
  async respond(...responses: FakeResponse[]): Promise<void> {
    await fetch(`${E2E_FAKE_LLM_URL}/__fake/responses`, {
      method: 'POST',
      body: JSON.stringify({ responses }),
    })
  },
  async requests(): Promise<FakeRequest[]> {
    const response = await fetch(`${E2E_FAKE_LLM_URL}/__fake/requests`)
    return ((await response.json()) as { requests: FakeRequest[] }).requests
  },
}

/** Selects the whole paragraph that shows `text` in the editable document. */
export async function selectParagraph(page: Page, text: string): Promise<void> {
  await editorOf(page).getByText(text, { exact: false }).first().click({ clickCount: 3 })
}

/** The floating selection toolbar (R20-ai-toolbar). */
export function selectionToolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Selection actions' })
}

/** The suggestion card (R20-ai-suggestion). */
export function suggestionCard(page: Page) {
  return page.getByRole('dialog', { name: 'AI suggestion' })
}

/** Rows of `assist_calls` (the metering of every assist model call). */
export async function assistCalls(
  pool: pg.Pool,
  lessonId: string,
): Promise<
  { kind: string; model: string; tokensIn: number; tokensOut: number; costUsd: number }[]
> {
  const result = await pool.query<{
    kind: string
    model: string
    tokens_in: number
    tokens_out: number
    cost_usd: string
  }>(
    `SELECT kind, model, tokens_in, tokens_out, cost_usd::text AS cost_usd
     FROM assist_calls WHERE lesson_id = $1 ORDER BY created_at`,
    [lessonId],
  )
  return result.rows.map((row) => ({
    kind: row.kind,
    model: row.model,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costUsd: Number(row.cost_usd),
  }))
}

/** Spends the whole global budget with one assist call row, so the next call must be refused. */
export async function exhaustBudget(pool: pg.Pool, lessonId: string, usd: number): Promise<void> {
  await pool.query(
    `INSERT INTO assist_calls (lesson_id, kind, model, tokens_in, tokens_out, cost_usd)
     VALUES ($1, 'rewrite', 'claude-haiku-5-5', 0, 0, $2)`,
    [lessonId, usd],
  )
}

export async function lessonStatus(pool: pg.Pool, lessonId: string): Promise<string> {
  const result = await pool.query<{ status: string }>('SELECT status FROM lessons WHERE id = $1', [
    lessonId,
  ])
  return result.rows[0]!.status
}

export async function workflowNotes(pool: pg.Pool, lessonId: string): Promise<(string | null)[]> {
  const result = await pool.query<{ note: string | null }>(
    'SELECT note FROM workflow_events WHERE lesson_id = $1 ORDER BY at',
    [lessonId],
  )
  return result.rows.map((row) => row.note)
}
