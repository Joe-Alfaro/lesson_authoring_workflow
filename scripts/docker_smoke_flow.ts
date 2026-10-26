/**
 * The R31 flow in real browsers against the three production containers, run by
 * scripts/docker_smoke.sh after docker_smoke_checks.ts: import the sample unit, generate three
 * lessons through the worker, two people co-edit one lesson through the web app's COLLAB_URL,
 * approve it and see the other editor lock, and the pre-deploy migration's id backfill.
 *
 * The model is a fake Anthropic API started here (tests/e2e/fake_anthropic.ts); the containers
 * reach it through ANTHROPIC_BASE_URL with a fake key, so nothing can reach Anthropic.
 *
 * Env: SMOKE_WEB_URL, SMOKE_COLLAB_URL, SMOKE_SEED_PASSWORD, SMOKE_FAKE_LLM_PORT,
 * SMOKE_POSTGRES_URL, SMOKE_COMPOSE_FILE.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium, expect, type Browser, type Page } from '@playwright/test'
import pg from 'pg'
import { FAKE_USAGE, fakeLessonBody } from '../tests/e2e/fake_llm'
import { startFakeAnthropic } from '../tests/e2e/fake_anthropic'
import { SAMPLE_ELD_CSV, SAMPLE_OUTLINE_CSV } from '../tests/e2e/support'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const webUrl = requireEnv('SMOKE_WEB_URL')
const collabUrl = requireEnv('SMOKE_COLLAB_URL')
const password = requireEnv('SMOKE_SEED_PASSWORD')
const fakeLlmPort = Number(requireEnv('SMOKE_FAKE_LLM_PORT'))
const postgresUrl = requireEnv('SMOKE_POSTGRES_URL')
const composeFile = requireEnv('SMOKE_COMPOSE_FILE')
const GENERATED = [1, 2, 3]
const ARTIFACTS = 'test-results/docker_smoke'

let failures = 0
async function step(name: string, run: () => Promise<string | void>): Promise<boolean> {
  try {
    const detail = await run()
    console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`)
    return true
  } catch (error) {
    failures += 1
    console.log(`FAIL ${name}: ${(error as Error).message.split('\n').slice(0, 6).join(' | ')}`)
    return false
  }
}

async function signedIn(browser: Browser, email: string) {
  const context = await browser.newContext({
    baseURL: webUrl,
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  const sockets: string[] = []
  page.on('websocket', (socket) => sockets.push(socket.url()))
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
  return { context, page, sockets }
}

function editorOf(page: Page, lessonNumber: number) {
  return page.getByRole('textbox', { name: `Lesson ${lessonNumber} editor` })
}

/** A Say line of the lesson the fake model writes (tests/fixtures/lesson/lesson_fixture.ts). */
const SAY_TEXT = 'Turn and tell a partner one thing you remember.'

/** Types at the end of the editor paragraph showing SAY_TEXT. */
async function typeInEditor(page: Page, lessonNumber: number, text: string) {
  await editorOf(page, lessonNumber).getByText(SAY_TEXT, { exact: false }).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

interface ContentNode {
  id?: string
  sections?: ContentNode[]
  parts?: ContentNode[]
  blocks?: ContentNode[]
}

function stripIds(content: { body: ContentNode }): number {
  let removed = 0
  for (const section of content.body.sections ?? []) {
    if (section.id) removed += 1
    delete section.id
    for (const part of section.parts ?? []) {
      if (part.id) removed += 1
      delete part.id
      for (const block of part.blocks ?? []) {
        if (block.id) removed += 1
        delete block.id
      }
    }
  }
  return removed
}

const fake = await startFakeAnthropic(fakeLlmPort, {
  answer: (request) => ({
    output: fakeLessonBody({ ...request, schema: {} }),
    usage: FAKE_USAGE,
    delayMs: 300,
  }),
})
const pool = new pg.Pool({ connectionString: postgresUrl, max: 2 })
const browser = await chromium.launch()
mkdirSync(ARTIFACTS, { recursive: true })

try {
  const author = await signedIn(browser, 'author01@example.com')
  let unitPath = ''
  await step('author imports the sample unit (outline + ELD CSV)', async () => {
    const page = author.page
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Units' })
      .click()
    const importAction = 'Import an outline'
    await page
      .getByRole('link', { name: importAction })
      .or(page.getByRole('button', { name: importAction }))
      .click()
    await page.getByRole('tab', { name: 'Upload CSV' }).click()
    await page.getByLabel(/csv file/i).setInputFiles(SAMPLE_OUTLINE_CSV)
    await page.getByLabel(/ELD scope and sequence/).setInputFiles(SAMPLE_ELD_CSV)
    await page.getByRole('button', { name: 'Read outline' }).click()
    await page.getByRole('button', { name: 'Create unit with 41 lessons' }).click()
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}/)
    unitPath = new URL(page.url()).pathname
    return `${unitPath}, 41 lessons`
  })

  const lessonIds = new Map<number, string>()
  await step(`worker generates lessons ${GENERATED.join(', ')} with the fake model`, async () => {
    const page = author.page
    for (const n of GENERATED) {
      await page.getByRole('checkbox', { name: `Select lesson ${n}`, exact: true }).check()
    }
    await page.getByRole('button', { name: 'Generate lessons...' }).click()
    const dialog = page.getByRole('dialog', { name: 'Generate lessons' })
    await dialog.getByRole('radio', { name: 'Selected lessons' }).check()
    await dialog.getByRole('button', { name: 'Start generation' }).click()
    for (const n of GENERATED) {
      await expect(page.getByRole('img', { name: `Lesson ${n}, Draft`, exact: true })).toBeVisible({
        timeout: 60_000,
      })
    }
    const rows = await pool.query<{ number: number; id: string }>(
      'SELECT lesson_number AS number, id FROM lessons WHERE lesson_number = ANY($1) AND content IS NOT NULL',
      [GENERATED],
    )
    rows.rows.forEach((row) => lessonIds.set(row.number, row.id))
    if (lessonIds.size !== GENERATED.length)
      throw new Error(`${lessonIds.size} lessons have content`)
    const runs = await pool.query<{ model: string; cost: string }>(
      'SELECT model, cost_usd::text AS cost FROM generation_runs',
    )
    const run = runs.rows[0]
    const fakeLog = (await (
      await fetch(`http://localhost:${fakeLlmPort}/__fake/requests`)
    ).json()) as { requests: unknown[] }
    return `run on ${run?.model}, recorded cost $${run?.cost}, ${fakeLog.requests.length} calls to the fake model`
  })

  await step('pre-deploy migration backfills ids on a lesson saved without them', async () => {
    const lessonId = lessonIds.get(3)
    if (!lessonId) throw new Error('lesson 3 was not generated')
    const before = await pool.query<{ content: { body: ContentNode } }>(
      'SELECT content FROM lessons WHERE id = $1',
      [lessonId],
    )
    const content = before.rows[0]!.content
    const removed = stripIds(content)
    await pool.query('UPDATE lessons SET content = $2 WHERE id = $1', [lessonId, content])
    const output = execFileSync(
      'docker',
      [
        'compose',
        '-f',
        composeFile,
        'run',
        '--rm',
        '--no-deps',
        'web',
        'node',
        'dist/db/migrate_cli.mjs',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    if (!/Gave 1 lesson\(s\)/.test(output)) throw new Error(`migrate said: ${output.trim()}`)
    const after = await pool.query<{ content: { body: ContentNode } }>(
      'SELECT content FROM lessons WHERE id = $1',
      [lessonId],
    )
    const restored = stripIds(structuredClone(after.rows[0]!.content))
    if (restored !== removed) throw new Error(`${restored} ids back of ${removed}`)
    return `${removed} ids removed, migrate_cli printed "${output.trim().split('\n').pop()}"`
  })

  const lessonId = lessonIds.get(1)
  const reviewer = await signedIn(browser, 'reviewer01@example.com')
  const approver = await signedIn(browser, 'approver01@example.com')
  const opened = await step('two browsers open lesson 1 in the editor', async () => {
    if (!lessonId) throw new Error('lesson 1 was not generated')
    for (const person of [reviewer, approver]) {
      await person.page.goto(`/lessons/${lessonId}`)
      await expect(editorOf(person.page, 1)).toBeVisible({ timeout: 20_000 })
    }
    await expect(reviewer.page.getByLabel('Also editing: Approver 01')).toBeVisible()
    await expect(approver.page.getByLabel('Also editing: Reviewer 01')).toBeVisible()
    return 'each shows the other as also editing'
  })

  await step(`the editors connect to collab through COLLAB_URL ${collabUrl}`, async () => {
    const all = [...reviewer.sockets, ...approver.sockets]
    if (!opened || !all.some((url) => url.startsWith(collabUrl))) {
      throw new Error(`browser WebSockets: ${all.join(', ') || 'none'}`)
    }
    return `${all.filter((url) => url.startsWith(collabUrl)).length} WebSockets`
  })

  await step('co-editing: each browser sees the other’s typing', async () => {
    await typeInEditor(reviewer.page, 1, ' Smoke edit from reviewer.')
    await expect(editorOf(approver.page, 1)).toContainText('Smoke edit from reviewer.', {
      timeout: 5_000,
    })
    await typeInEditor(approver.page, 1, ' Smoke edit from approver.')
    await expect(editorOf(reviewer.page, 1)).toContainText('Smoke edit from approver.', {
      timeout: 5_000,
    })
    await expect(reviewer.page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 })
    await reviewer.page.screenshot({ path: `${ARTIFACTS}/co_edit.png` })
  })

  await step('connections stay within the documented budget', async () => {
    const result = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = 'lesson_authoring' AND backend_type = 'client backend'",
    )
    const used = result.rows[0]!.n - 2 // this script's own pool
    // docs/deploy.md: web 10 + 1 + 2, worker 5 + 2, collab 10 (its LISTEN included).
    if (used > 30) throw new Error(`${used} connections`)
    return `${used} of at most 30`
  })

  await step('approver submits and approves; the reviewer’s open editor locks live', async () => {
    await approver.page.getByRole('button', { name: 'Submit for review' }).click()
    await approver.page.getByRole('button', { name: 'Approve lesson' }).click()
    await expect(approver.page.getByRole('button', { name: 'Reopen for edits' })).toBeVisible()
    await expect(
      reviewer.page.getByRole('status').filter({ hasText: 'This lesson is approved' }),
    ).toContainText('editing is locked', { timeout: 10_000 })
    await expect(editorOf(reviewer.page, 1)).toHaveCount(0)
    const status = await pool.query<{ status: string }>(
      'SELECT status FROM lessons WHERE id = $1',
      [lessonId],
    )
    const content = await pool.query<{ text: string }>(
      'SELECT content::text AS text FROM lessons WHERE id = $1',
      [lessonId],
    )
    const kept = ['reviewer', 'approver'].every((who) =>
      content.rows[0]?.text.includes(`Smoke edit from ${who}.`),
    )
    if (status.rows[0]?.status !== 'approved' || !kept) {
      throw new Error(`status ${status.rows[0]?.status}, both edits saved: ${kept}`)
    }
    await reviewer.page.screenshot({ path: `${ARTIFACTS}/approved_locked.png` })
    return 'status approved, both edits in lessons.content'
  })
} finally {
  await browser.close()
  await pool.end()
  await fake.stop()
}

console.log(
  failures === 0 ? 'All browser flow checks passed' : `${failures} browser flow check(s) failed`,
)
process.exit(failures === 0 ? 0 : 1)
