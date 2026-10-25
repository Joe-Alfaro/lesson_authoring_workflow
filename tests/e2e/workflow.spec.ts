// R23 review workflow in the editor's lesson bar: status pill and the actions each role gets in
// each status, the request-changes dialog (note required), the history timeline, and the approved
// lock reaching editors that are already open. Mockups in docs/design/lesson-authoring/:
// R23-workflow-states, R23-request-changes, R23-history, R23-approved-locked.
// Contract: src/assist/README.md (M4 workflow UI).
import type pg from 'pg'
import { lessonStatus, workflowNotes } from './assist_support'
import {
  APPROVER_1,
  createLesson,
  editorOf,
  openEditor,
  REVIEWER_1,
  REVIEWER_3,
  SAY_TEXT,
  signedInPage,
} from './lesson_support'
import { AUTHOR, expect, expectNoAxeViolations, signIn, snap, test } from './support'

const ACTIONS = [
  'Submit for review',
  'Resubmit for review',
  'Request changes',
  'Approve lesson',
  'Reopen for edits',
]

const STATUS_LABELS: Record<string, string> = {
  generating: 'Generating',
  draft: 'Draft',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
}

/** The status pill in the lesson bar (icon plus word). */
function statusPill(page: import('@playwright/test').Page, label: string) {
  return page.getByText(label, { exact: true }).first()
}

async function userId(pool: pg.Pool, email: string): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
  return result.rows[0]!.id
}

test.describe('Lesson bar by status and role (R23-workflow-states)', () => {
  const rows: {
    status: string
    who: { email: string; name: string }
    role: string
    actions: string[]
    caption?: string
  }[] = [
    { status: 'draft', who: REVIEWER_1, role: 'reviewer', actions: ['Submit for review'] },
    {
      status: 'in_review',
      who: REVIEWER_1,
      role: 'reviewer',
      actions: [],
      caption: 'Waiting for an approver',
    },
    {
      status: 'in_review',
      who: APPROVER_1,
      role: 'approver',
      actions: ['Request changes', 'Approve lesson'],
    },
    {
      status: 'changes_requested',
      who: REVIEWER_1,
      role: 'reviewer',
      actions: ['Resubmit for review'],
    },
    { status: 'approved', who: APPROVER_1, role: 'approver', actions: ['Reopen for edits'] },
    {
      status: 'approved',
      who: REVIEWER_1,
      role: 'reviewer',
      actions: [],
      caption: 'Locked. Ask an approver to reopen.',
    },
    {
      status: 'generating',
      who: REVIEWER_1,
      role: 'reviewer',
      actions: [],
      caption: 'Opens for editing when generation finishes',
    },
    // Authors take no review action (D-030).
    { status: 'draft', who: AUTHOR, role: 'author', actions: [] },
    { status: 'approved', who: AUTHOR, role: 'author', actions: [] },
  ]

  for (const row of rows) {
    test(`${row.status} as ${row.role}: ${row.actions.join(', ') || row.caption || 'no actions'}`, async ({
      db,
      page,
      pool,
    }, testInfo) => {
      expect(await db.count('units')).toBe(0)
      const { lessonId } = await createLesson(pool, {
        status: row.status,
        assigneeEmail: REVIEWER_3.email,
      })
      await signIn(page, row.who.email)
      await page.goto(`/lessons/${lessonId}`)
      await expect(page.getByRole('article', { name: 'Lesson 4 editor' })).toContainText(
        SAY_TEXT.slice(0, 20),
      )
      await expect(statusPill(page, STATUS_LABELS[row.status]!)).toBeVisible()
      await expect(page.getByText('Assigned to')).toBeVisible()
      for (const action of ACTIONS) {
        await expect(page.getByRole('button', { name: action, exact: true })).toHaveCount(
          row.actions.includes(action) ? 1 : 0,
        )
      }
      if (row.caption) {
        await expect(page.getByText(row.caption)).toBeVisible()
      }
      await snap(page, testInfo, `R23-workflow-states-${row.status}-${row.role}`)
    })
  }
})

test.describe('Review actions (R23)', () => {
  test('a reviewer submits a draft for review', async ({ db, page, pool }) => {
    expect(await db.count('units')).toBe(0)
    const { lessonId } = await createLesson(pool, { assigneeEmail: REVIEWER_1.email })
    await signIn(page, REVIEWER_1.email)
    await openEditor(page, lessonId)
    await page.getByRole('button', { name: 'Submit for review' }).click()
    await expect(statusPill(page, 'In review')).toBeVisible()
    await expect(page.getByText('Waiting for an approver')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0)
    expect(await lessonStatus(pool, lessonId)).toBe('in_review')
  })

  test('an approver requests changes; the note is required', async ({
    db,
    page,
    pool,
  }, testInfo) => {
    expect(await db.count('units')).toBe(0)
    const { lessonId } = await createLesson(pool, {
      status: 'in_review',
      assigneeEmail: REVIEWER_3.email,
    })
    await signIn(page, APPROVER_1.email)
    await openEditor(page, lessonId)
    await page.getByRole('button', { name: 'Request changes' }).click()

    const dialog = page.getByRole('dialog', { name: 'Request changes to Lesson 4' })
    await expect(dialog).toContainText(
      'The lesson goes back to Reviewer 03 as Changes requested. Your note appears in its history.',
    )
    const note = dialog.getByLabel('Note for the reviewer')
    await expect(note).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()

    // Empty note: refused with the message, nothing changes.
    await dialog.getByRole('button', { name: 'Request changes' }).click()
    await expect(dialog.getByText('Add a note so the reviewer knows what to change.')).toBeVisible()
    await expect(note).toHaveAttribute('aria-invalid', 'true')
    await snap(page, testInfo, 'R23-request-changes')
    await expectNoAxeViolations(page)
    expect(await lessonStatus(pool, lessonId)).toBe('in_review')

    // Whitespace isn't a note either.
    await note.fill('   ')
    await dialog.getByRole('button', { name: 'Request changes' }).click()
    await expect(note).toHaveAttribute('aria-invalid', 'true')
    expect(await lessonStatus(pool, lessonId)).toBe('in_review')

    const text = 'Part B asks for an inference, but RL.6.2 needs students to name a central idea.'
    await note.fill(text)
    await dialog.getByRole('button', { name: 'Request changes' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(statusPill(page, 'Changes requested')).toBeVisible()
    expect(await lessonStatus(pool, lessonId)).toBe('changes_requested')
    expect(await workflowNotes(pool, lessonId)).toEqual([text])
  })

  test('Cancel closes the request-changes dialog without changing anything', async ({
    db,
    page,
    pool,
  }) => {
    expect(await db.count('units')).toBe(0)
    const { lessonId } = await createLesson(pool, { status: 'in_review' })
    await signIn(page, APPROVER_1.email)
    await openEditor(page, lessonId)
    await page.getByRole('button', { name: 'Request changes' }).click()
    const dialog = page.getByRole('dialog', { name: 'Request changes to Lesson 4' })
    await dialog.getByLabel('Note for the reviewer').fill('Never sent.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await lessonStatus(pool, lessonId)).toBe('in_review')
    expect(await workflowNotes(pool, lessonId)).toEqual([])
  })

  test('resubmit, approve: the reviewer’s open editor locks live; reopen unlocks it', async ({
    browser,
    db,
    page,
    pool,
  }, testInfo) => {
    expect(await db.count('units')).toBe(0)
    const { lessonId } = await createLesson(pool, {
      status: 'changes_requested',
      assigneeEmail: REVIEWER_1.email,
    })
    await signIn(page, REVIEWER_1.email)
    await openEditor(page, lessonId)
    await page.getByRole('button', { name: 'Resubmit for review' }).click()
    await expect(statusPill(page, 'In review')).toBeVisible()
    expect(await lessonStatus(pool, lessonId)).toBe('in_review')

    const approver = await signedInPage(browser, APPROVER_1)
    try {
      await openEditor(approver.page, lessonId)
      await approver.page.getByRole('button', { name: 'Approve lesson' }).click()
      await expect(statusPill(approver.page, 'Approved')).toBeVisible()
      await expect(approver.page.getByRole('button', { name: 'Reopen for edits' })).toBeVisible()
      expect(await lessonStatus(pool, lessonId)).toBe('approved')

      // The reviewer never reloads: their editor turns read-only within a few seconds.
      await expect(
        page.getByRole('status').filter({ hasText: 'This lesson is approved' }),
      ).toContainText('This lesson is approved, so editing is locked.', { timeout: 5_000 })
      await expect(editorOf(page)).toHaveCount(0)
      await expect(statusPill(page, 'Approved')).toBeVisible()
      await expect(page.getByText('Locked. Ask an approver to reopen.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add a part' })).toHaveCount(0)
      await snap(page, testInfo, 'R23-approved-locked-live')

      // Reopen returns it to In review, and the reviewer can edit again without reloading.
      await approver.page.getByRole('button', { name: 'Reopen for edits' }).click()
      await expect(statusPill(approver.page, 'In review')).toBeVisible()
      expect(await lessonStatus(pool, lessonId)).toBe('in_review')
      await expect(editorOf(page)).toBeVisible({ timeout: 5_000 })
      await expect(statusPill(page, 'In review')).toBeVisible()
    } finally {
      await approver.context.close()
    }
  })
})

test.describe('History (R23-history)', () => {
  test.use({ timezoneId: 'UTC' })

  test('the History tab is a timeline of who did what and when, notes quoted', async ({
    db,
    page,
    pool,
  }, testInfo) => {
    expect(await db.count('units')).toBe(0)
    const { lessonId } = await createLesson(pool, {
      status: 'in_review',
      assigneeEmail: REVIEWER_3.email,
    })
    const reviewer = await userId(pool, REVIEWER_3.email)
    const approver = await userId(pool, APPROVER_1.email)
    const now = new Date()
    const today = (hours: number, minutes: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes))
    const note =
      'Part B asks for an inference, but RL.6.2 needs students to name a central idea. Add one Ask about what the opening suggests the story is about.'
    const events: [string | null, string, string | null, Date, string | null][] = [
      [null, 'generating', null, today(10, 30), null],
      ['generating', 'draft', null, today(10, 44), null],
      ['draft', 'in_review', reviewer, today(11, 48), null],
      ['in_review', 'changes_requested', approver, today(13, 5), note],
      ['changes_requested', 'in_review', reviewer, today(14, 20), null],
    ]
    for (const [from, to, actor, at, eventNote] of events) {
      await pool.query(
        `INSERT INTO workflow_events (lesson_id, from_status, to_status, actor_id, note, at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [lessonId, from, to, actor, eventNote, at],
      )
    }

    await signIn(page, REVIEWER_1.email)
    await openEditor(page, lessonId)
    await page.getByRole('button', { name: 'Version history' }).click()
    await page.getByRole('tab', { name: 'History' }).click()
    const panel = page.getByRole('tabpanel', { name: 'History' })
    await expect(panel.getByRole('heading', { name: 'Status history' })).toBeVisible()
    const items = panel.getByRole('list').getByRole('listitem')
    await expect(items).toHaveCount(5)

    // Newest first.
    await expect(items.nth(0)).toContainText('Reviewer 03 resubmitted for review')
    await expect(items.nth(0)).toContainText('14:20')
    await expect(items.nth(1)).toContainText('Approver 01 requested changes')
    await expect(items.nth(1)).toContainText('13:05')
    await expect(items.nth(1)).toContainText(note)
    await expect(items.nth(2)).toContainText('Reviewer 03 submitted for review')
    await expect(items.nth(2)).toContainText('11:48')
    await expect(items.nth(3)).toContainText('System generated as Draft')
    await expect(items.nth(3)).toContainText('10:44')
    await expect(items.nth(4)).toContainText('System started generating')
    await snap(page, testInfo, 'R23-history')
    await expectNoAxeViolations(page)
  })

  test('a transition made in the editor shows up in the timeline', async ({ db, page, pool }) => {
    expect(await db.count('units')).toBe(0)
    const { lessonId } = await createLesson(pool, { status: 'in_review' })
    await signIn(page, APPROVER_1.email)
    await openEditor(page, lessonId)
    await page.getByRole('button', { name: 'Version history' }).click()
    await page.getByRole('tab', { name: 'History' }).click()
    await page.getByRole('button', { name: 'Approve lesson' }).click()
    await expect(statusPill(page, 'Approved')).toBeVisible()
    const panel = page.getByRole('tabpanel', { name: 'History' })
    await expect(panel.getByRole('listitem').first()).toContainText('Approver 01 approved', {
      timeout: 5_000,
    })
  })
})
