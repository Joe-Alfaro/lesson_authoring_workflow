// Helpers for the M3 editor specs: lessons and versions are written straight into the e2e
// database (no import, no generation, no Anthropic calls). Contract: src/editor/README.md.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import type pg from 'pg'
import type { LessonContent } from '../../src/lesson/schema'
import { richLessonContent } from '../fixtures/lesson/rich_lesson_fixture'
import { expect, signIn } from './support'

export const REVIEWER_1 = { email: 'reviewer01@example.com', name: 'Reviewer 01' }
export const REVIEWER_2 = { email: 'reviewer02@example.com', name: 'Reviewer 02' }
export const REVIEWER_3 = { email: 'reviewer03@example.com', name: 'Reviewer 03' }
export const APPROVER_1 = { email: 'approver01@example.com', name: 'Approver 01' }

/** The Say block of the rich fixture as the editor shows it (marks rendered, no asterisks). */
export const SAY_TEXT = 'Today we meet a narrator who says he is not a normal kid.'
/** The Launch Ask question of the rich fixture. */
export const ASK_TEXT = 'What might a story about a problem kid be about?'

/** Full text of a seeded standard, read from the same data the seed loads. */
export function standardText(code: string): string {
  const file = resolve(import.meta.dirname, '../../data/standards/ccss_ela_grade6.json')
  const records = JSON.parse(readFileSync(file, 'utf8')) as { code: string; text: string }[]
  const record = records.find((r) => r.code === code)
  if (!record) throw new Error(`No standard ${code}`)
  return record.text
}

async function userId(pool: pg.Pool, email: string): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
  return result.rows[0]!.id
}

export interface CreatedLesson {
  unitId: string
  lessonId: string
}

/** One unit with one arc and lesson 4 holding `content` (the rich fixture by default). */
export async function createLesson(
  pool: pg.Pool,
  options: { status?: string; content?: LessonContent; assigneeEmail?: string } = {},
): Promise<CreatedLesson> {
  const unit = await pool.query<{ id: string }>(
    `INSERT INTO units (grade, unit_number, anchor_text_title, banner)
     VALUES (6, 4, 'Placeholder Anchor Novel', 'G6') RETURNING id`,
  )
  const unitId = unit.rows[0]!.id
  const arc = await pool.query<{ id: string }>(
    `INSERT INTO arcs (unit_id, name, position) VALUES ($1, 'Investigation 1', 0) RETURNING id`,
    [unitId],
  )
  const assignee = options.assigneeEmail ? await userId(pool, options.assigneeEmail) : null
  const lesson = await pool.query<{ id: string }>(
    `INSERT INTO lessons (unit_id, arc_id, position, lesson_number, filename, lesson_type,
       description, raw_row, status, content, assignee_id, focus_standards)
     VALUES ($1, $2, 0, 4, 'L4_TE', 'Core Reading', 'Lesson 4 outline line.', '{}',
       $3, $4, $5, 'RL.6.1, RL.6.2') RETURNING id`,
    [
      unitId,
      arc.rows[0]!.id,
      options.status ?? 'draft',
      options.content ?? richLessonContent(),
      assignee,
    ],
  )
  return { unitId, lessonId: lesson.rows[0]!.id }
}

/** Inserts a version at a fixed time; `authorEmail` null means generated. */
export async function addVersion(
  pool: pg.Pool,
  lessonId: string,
  content: LessonContent,
  authorEmail: string | null,
  createdAt: Date,
): Promise<string> {
  const author = authorEmail ? await userId(pool, authorEmail) : null
  const result = await pool.query<{ id: string }>(
    `INSERT INTO lesson_versions (lesson_id, content, author_id, created_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [lessonId, content, author, createdAt],
  )
  return result.rows[0]!.id
}

export async function storedContent(pool: pg.Pool, lessonId: string): Promise<LessonContent> {
  const result = await pool.query<{ content: LessonContent }>(
    'SELECT content FROM lessons WHERE id = $1',
    [lessonId],
  )
  return result.rows[0]!.content
}

export async function versionCount(pool: pg.Pool, lessonId: string): Promise<number> {
  const result = await pool.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM lesson_versions WHERE lesson_id = $1',
    [lessonId],
  )
  return Number(result.rows[0]!.n)
}

/** The rich fixture with the Launch Say block's text replaced. */
export function withSay(text: string): LessonContent {
  const lesson = richLessonContent()
  const say = lesson.body.sections[0]!.parts[0]!.blocks[1]!
  if (say.type !== 'say') throw new Error('fixture changed')
  say.text = text
  return lesson
}

/** The editable lesson document (ProseMirror root: role textbox, named "Lesson N editor"). */
export function editorOf(page: Page, number = 4) {
  return page.getByRole('textbox', { name: `Lesson ${number} editor` })
}

/** Opens the editor and waits until the document has synced from the collab server. */
export async function openEditor(page: Page, lessonId: string) {
  await page.goto(`/lessons/${lessonId}`)
  const editor = editorOf(page)
  await expect(editor).toContainText(SAY_TEXT.slice(0, 20))
  return editor
}

/** A separate signed-in browser session, as a second person on another computer. */
export async function signedInPage(
  browser: Browser,
  user: { email: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await signIn(page, user.email)
  return { context, page }
}

/** Puts the caret at the end (or start) of the paragraph showing `text`. */
export async function caretIn(page: Page, text: string, where: 'end' | 'start' = 'end') {
  await editorOf(page).getByText(text, { exact: false }).first().click()
  await page.keyboard.press(where === 'end' ? 'End' : 'Home')
}
