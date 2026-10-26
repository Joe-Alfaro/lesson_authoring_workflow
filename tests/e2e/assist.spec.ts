// M4 AI assist in the editor: R20 selection actions (rewrite, shorten, simplify, free-form), R21
// regenerate one section, R22 standards alignment, metering and the global budget. The model is
// the fake Anthropic API (fake_anthropic.ts). Mockups in docs/design/lesson-authoring/:
// R20-ai-toolbar, R20-ai-instruction, R20-ai-pending, R20-ai-suggestion, R21-regenerate-section,
// R21-section-preview, R22-alignment-check. Contract: src/assist/README.md.
import { LessonContent } from '../../src/lesson/schema'
import { richLessonContent } from '../fixtures/lesson/rich_lesson_fixture'
import {
  assistCalls,
  exhaustBudget,
  fakeLlm,
  selectionToolbar,
  selectParagraph,
  suggestionCard,
} from './assist_support'
import { E2E_SPEND_CAP_USD } from './env'
import {
  APPROVER_1,
  caretIn,
  createLesson,
  editorOf,
  openEditor,
  REVIEWER_1,
  REVIEWER_2,
  SAY_TEXT,
  signedInPage,
  standardText,
  storedContent,
} from './lesson_support'
import { AUTHOR, expect, expectNoAxeViolations, signIn, snap, test } from './support'

const SUGGESTION = 'Today we meet a narrator who calls himself a problem kid.'
const SECOND_SUGGESTION = 'Meet a narrator who calls himself a problem kid.'
/** The start of the Launch Say text however the prompt renders its marks. */
const SAY_START = 'Today we meet a narrator who says he is'

async function sayText(pool: Parameters<typeof storedContent>[0], lessonId: string) {
  const block = (await storedContent(pool, lessonId)).body.sections[0]!.parts[0]!.blocks[1]!
  return block.type === 'say' ? block.text : null
}

// `db` empties units (cascading to lessons and assist_calls), so spend from one test never
// counts against the budget of the next.
test.beforeEach(async ({ db }) => {
  expect(await db.count('units')).toBe(0)
  await fakeLlm.reset()
})

test.describe('Selection actions (R20)', () => {
  test('rewrite: preview, nothing changes until accept, accept syncs and is one undo step', async ({
    browser,
    page,
    pool,
  }, testInfo) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    const other = await signedInPage(browser, REVIEWER_2)
    try {
      await openEditor(other.page, lessonId)
      await fakeLlm.respond({ output: { text: SUGGESTION }, delayMs: 2_500 })

      await selectParagraph(page, SAY_TEXT)
      const toolbar = selectionToolbar(page)
      await expect(toolbar).toBeVisible()
      for (const name of ['Rewrite', 'Shorten', 'Simplify for grade 6', 'Ask AI...']) {
        await expect(toolbar.getByRole('button', { name })).toBeVisible()
      }
      await snap(page, testInfo, 'R20-ai-toolbar')
      await expectNoAxeViolations(page)

      await toolbar.getByRole('button', { name: 'Rewrite' }).click()
      const pending = page.getByRole('status').filter({ hasText: 'Writing a suggestion.' })
      await expect(pending).toContainText(
        'Writing a suggestion. Nothing in the lesson changes until you accept it.',
      )
      await expect(pending).toContainText('Rewrite')
      await expect(pending.getByRole('button', { name: 'Cancel' })).toBeVisible()
      await snap(page, testInfo, 'R20-ai-pending')

      const card = suggestionCard(page)
      await expect(card).toBeVisible()
      await expect(card).toContainText(
        'Enter to accept, Esc to reject. Accepting can be undone in one step.',
      )
      await expect(card.getByRole('button', { name: 'Accept' })).toBeFocused()
      await expect(card.getByRole('button', { name: 'Reject' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible()
      // Inline diff: the selection struck through, the suggestion beside it.
      await expect(page.getByLabel('Removed text')).toContainText(SAY_TEXT)
      await expect(page.getByLabel('Suggested text')).toContainText(SUGGESTION)
      await snap(page, testInfo, 'R20-ai-suggestion')
      await expectNoAxeViolations(page)

      // The model got the selection. Nothing changed yet, here, on the server or for the other user.
      const [request] = await fakeLlm.requests()
      expect(`${request!.system}\n${request!.prompt}`).toContain(SAY_START)
      expect(await sayText(pool, lessonId)).toBe(
        'Today we meet a narrator who says he is **not** a normal kid.',
      )
      await expect(editorOf(other.page)).toContainText(SAY_TEXT)
      await expect(editorOf(other.page)).not.toContainText(SUGGESTION)

      await card.getByRole('button', { name: 'Accept' }).click()
      await expect(card).toHaveCount(0)
      await expect(editor).toContainText(SUGGESTION)
      await expect(editor).not.toContainText(SAY_TEXT)
      await expect(editor).toBeFocused()
      // Collaboration: the accepted change reaches the other editor (R18) and the server.
      await expect(editorOf(other.page)).toContainText(SUGGESTION, { timeout: 2_000 })
      await expect.poll(() => sayText(pool, lessonId), { timeout: 10_000 }).toBe(SUGGESTION)

      // One undo reverts the whole suggestion, for everyone.
      await page.keyboard.press('ControlOrMeta+z')
      await expect(editor).toContainText(SAY_TEXT)
      await expect(editor).not.toContainText(SUGGESTION)
      await expect(editorOf(other.page)).toContainText(SAY_TEXT, { timeout: 2_000 })

      // Metered: one call, priced on the Haiku-class default model.
      const calls = await assistCalls(pool, lessonId)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        kind: 'rewrite',
        model: 'claude-haiku-5-5',
        tokensIn: 1000,
        tokensOut: 1000,
      })
      expect(calls[0]!.costUsd).toBeGreaterThan(0)
    } finally {
      await other.context.close()
    }
  })

  test('Reject and Escape leave the lesson unchanged; simplify asks for the unit grade', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    await fakeLlm.respond({ output: { text: SUGGESTION } }, { output: { text: SECOND_SUGGESTION } })

    await selectParagraph(page, SAY_TEXT)
    await selectionToolbar(page).getByRole('button', { name: 'Shorten' }).click()
    await suggestionCard(page).getByRole('button', { name: 'Reject' }).click()
    await expect(suggestionCard(page)).toHaveCount(0)
    await expect(editor).toContainText(SAY_TEXT)
    await expect(editor).not.toContainText(SUGGESTION)

    await selectParagraph(page, SAY_TEXT)
    await selectionToolbar(page).getByRole('button', { name: 'Simplify for grade 6' }).click()
    await expect(suggestionCard(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(suggestionCard(page)).toHaveCount(0)
    await expect(editor).toContainText(SAY_TEXT)
    await expect(editor).not.toContainText(SECOND_SUGGESTION)

    const requests = await fakeLlm.requests()
    expect(requests).toHaveLength(2)
    expect(`${requests[1]!.system}\n${requests[1]!.prompt}`).toMatch(/grade 6/i)
    expect(await storedContent(pool, lessonId)).toEqual(richLessonContent())
  })

  test('Enter accepts the suggestion', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    await fakeLlm.respond({ output: { text: SUGGESTION } })
    await selectParagraph(page, SAY_TEXT)
    await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click()
    await expect(suggestionCard(page).getByRole('button', { name: 'Accept' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(editor).toContainText(SUGGESTION)
    await expect.poll(() => sayText(pool, lessonId), { timeout: 10_000 }).toBe(SUGGESTION)
  })

  test('Ask AI... sends a free-form instruction; Try again asks for another suggestion', async ({
    page,
    pool,
  }, testInfo) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    const instruction = 'Add a second example from page 3 and keep it under 3 sentences'
    await fakeLlm.respond({ output: { text: SUGGESTION } }, { output: { text: SECOND_SUGGESTION } })

    await selectParagraph(page, SAY_TEXT)
    await selectionToolbar(page).getByRole('button', { name: 'Ask AI...' }).click()
    const ask = page.getByRole('dialog', { name: 'Ask AI about the selection' })
    await ask.getByLabel('Instruction for the AI').fill(instruction)
    await snap(page, testInfo, 'R20-ai-instruction')
    await expectNoAxeViolations(page)
    await ask.getByRole('button', { name: 'Run' }).click()

    const card = suggestionCard(page)
    await expect(page.getByLabel('Suggested text')).toContainText(SUGGESTION)
    const [first] = await fakeLlm.requests()
    expect(`${first!.system}\n${first!.prompt}`).toContain(instruction)
    expect(`${first!.system}\n${first!.prompt}`).toContain(SAY_START)

    await card.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByLabel('Suggested text')).toContainText(SECOND_SUGGESTION)
    const requests = await fakeLlm.requests()
    expect(requests).toHaveLength(2)
    expect(`${requests[1]!.system}\n${requests[1]!.prompt}`).toContain(instruction)

    await card.getByRole('button', { name: 'Accept' }).click()
    await expect(editor).toContainText(SECOND_SUGGESTION)
    await expect.poll(() => sayText(pool, lessonId), { timeout: 10_000 }).toBe(SECOND_SUGGESTION)
  })

  test('Cancel while the suggestion is being written changes nothing', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    await fakeLlm.respond({ output: { text: SUGGESTION }, delayMs: 3_000 })
    await selectParagraph(page, SAY_TEXT)
    await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click()
    const pending = page.getByRole('status').filter({ hasText: 'Writing a suggestion.' })
    await pending.getByRole('button', { name: 'Cancel' }).click()
    await expect(pending).toHaveCount(0)
    // Even once the model answers, no suggestion appears and the lesson is unchanged.
    await page.waitForTimeout(3_500)
    await expect(suggestionCard(page)).toHaveCount(0)
    await expect(editor).toContainText(SAY_TEXT)
    expect(await storedContent(pool, lessonId)).toEqual(richLessonContent())
  })

  test('keyboard: Alt+/ opens the toolbar on a selection; arrow keys move between actions', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    await openEditor(page, lessonId)
    await caretIn(page, SAY_TEXT, 'start')
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('Alt+/')
    const toolbar = selectionToolbar(page)
    await expect(toolbar.getByRole('button', { name: 'Rewrite' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(toolbar.getByRole('button', { name: 'Shorten' })).toBeFocused()
  })

  test('not offered on an approved lesson', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool, { status: 'approved' })
    await signIn(page, APPROVER_1.email)
    await page.goto(`/lessons/${lessonId}`)
    const doc = page.getByRole('article', { name: 'Lesson 4 editor' })
    await expect(doc).toContainText(SAY_TEXT)
    await doc.getByText(SAY_TEXT).click({ clickCount: 3 })
    await page.keyboard.press('Alt+/')
    await expect(selectionToolbar(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Regenerate .* with AI$/ })).toHaveCount(0)
  })

  test('not offered to an author (reviewer and above only)', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, AUTHOR.email)
    await openEditor(page, lessonId)
    await selectParagraph(page, SAY_TEXT)
    await page.keyboard.press('Alt+/')
    await expect(selectionToolbar(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Regenerate .* with AI$/ })).toHaveCount(0)
  })

  test('refused with a clear message when the global budget is used up', async ({ page, pool }) => {
    const { lessonId } = await createLesson(pool)
    await exhaustBudget(pool, lessonId, E2E_SPEND_CAP_USD)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    await fakeLlm.respond({ output: { text: SUGGESTION } })
    await selectParagraph(page, SAY_TEXT)
    await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      `AI budget used up: $${E2E_SPEND_CAP_USD.toFixed(2)} of the $${E2E_SPEND_CAP_USD.toFixed(2)} spend cap is spent. Ask an admin to raise SPEND_CAP_USD.`,
    )
    await expect(suggestionCard(page)).toHaveCount(0)
    await expect(editor).toContainText(SAY_TEXT)
    expect(await fakeLlm.requests()).toHaveLength(0)
  })
})

/** The Look Back the fake model proposes (its id and minutes are wrong on purpose). */
const PROPOSED_PROMPT = 'Write one sentence that uses a vocabulary word from today.'
function proposedLookBack() {
  return {
    section: {
      id: 'model-made-this-up',
      kind: 'look_back',
      minutes: 9,
      purpose: 'Students use a vocabulary word to reflect.',
      parts: [
        {
          standards: [],
          blocks: [
            {
              type: 'reflection',
              prompt: PROPOSED_PROMPT,
              questions: ['Which word did you choose, and why?'],
            },
          ],
        },
      ],
    },
  }
}

test.describe('Regenerate one section (R21)', () => {
  test('dialog, preview in place, accept replaces only that section for everyone', async ({
    browser,
    page,
    pool,
  }, testInfo) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    const other = await signedInPage(browser, REVIEWER_2)
    try {
      await openEditor(other.page, lessonId)
      await fakeLlm.respond({ output: proposedLookBack(), delayMs: 500 })

      await page.getByRole('button', { name: 'Regenerate Look Back with AI' }).click()
      const dialog = page.getByRole('dialog', { name: 'Regenerate Look Back' })
      await expect(dialog).toContainText(
        'Only this section is rewritten. The rest of the lesson stays as it is, and you review the result before it replaces anything.',
      )
      const instruction = "Have students use one of today's vocabulary words in the Quick Write."
      await dialog.getByLabel('Instruction').fill(instruction)
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
      await snap(page, testInfo, 'R21-regenerate-section')
      await expectNoAxeViolations(page)
      await dialog.getByRole('button', { name: 'Regenerate section' }).click()

      const proposal = page.getByRole('region', { name: 'Proposed Look Back' })
      await expect(proposal).toContainText('Proposed Look Back.')
      await expect(proposal).toContainText(
        'Highlighted blocks replace the current section when you accept. Minutes stay at 5.',
      )
      for (const name of ['Accept', 'Reject', 'Try again', 'Show current version']) {
        await expect(proposal.getByRole('button', { name })).toBeVisible()
      }
      await expect(page.getByText(PROPOSED_PROMPT)).toBeVisible()
      await snap(page, testInfo, 'R21-section-preview')

      const [request] = await fakeLlm.requests()
      expect(`${request!.system}\n${request!.prompt}`).toContain(instruction)
      // Not applied yet: server and the other editor still have the current Look Back.
      expect(await storedContent(pool, lessonId)).toEqual(richLessonContent())
      await expect(editorOf(other.page)).toContainText('Rate yourself from 1 to 5.')
      await expect(editorOf(other.page)).not.toContainText(PROPOSED_PROMPT)

      await proposal.getByRole('button', { name: 'Accept' }).click()
      await expect(proposal).toHaveCount(0)
      await expect(editor).toContainText(PROPOSED_PROMPT)
      await expect(editor).not.toContainText('Rate yourself from 1 to 5.')
      await expect(editorOf(other.page)).toContainText(PROPOSED_PROMPT, { timeout: 2_000 })

      // Only Look Back changed; it kept its id and minutes; the lesson still validates.
      const original = richLessonContent()
      await expect
        .poll(async () => (await storedContent(pool, lessonId)).body.sections[3], {
          timeout: 10_000,
        })
        .toMatchObject({
          id: 'sec-lookback',
          kind: 'look_back',
          minutes: 5,
          parts: [{ blocks: [{ type: 'reflection', prompt: PROPOSED_PROMPT }] }],
        })
      const stored = await storedContent(pool, lessonId)
      expect(stored.body.sections.slice(0, 3)).toEqual(original.body.sections.slice(0, 3))
      expect(stored.frontMatter).toEqual(original.frontMatter)
      expect(stored.body.homework).toEqual(original.body.homework)
      expect(LessonContent.safeParse(stored).success).toBe(true)

      // Accepting is one undo step too.
      await page.keyboard.press('ControlOrMeta+z')
      await expect(editor).toContainText('Rate yourself from 1 to 5.')
      await expect(editor).not.toContainText(PROPOSED_PROMPT)
    } finally {
      await other.context.close()
    }
  })

  test('Reject keeps the current section; Show current version shows it', async ({
    page,
    pool,
  }) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    const editor = await openEditor(page, lessonId)
    await fakeLlm.respond({ output: proposedLookBack() })
    await page.getByRole('button', { name: 'Regenerate Look Back with AI' }).click()
    const dialog = page.getByRole('dialog', { name: 'Regenerate Look Back' })
    // The instruction is optional.
    await dialog.getByRole('button', { name: 'Regenerate section' }).click()
    const proposal = page.getByRole('region', { name: 'Proposed Look Back' })
    await expect(proposal).toBeVisible()

    await proposal.getByRole('button', { name: 'Show current version' }).click()
    await expect(editor).toContainText('Rate yourself from 1 to 5.')

    await proposal.getByRole('button', { name: 'Reject' }).click()
    await expect(proposal).toHaveCount(0)
    await expect(editor).toContainText('Rate yourself from 1 to 5.')
    await expect(page.getByText(PROPOSED_PROMPT)).toHaveCount(0)
    expect(await storedContent(pool, lessonId)).toEqual(richLessonContent())
  })
})

test.describe('Standards alignment check (R22)', () => {
  test('lists each focus standard with its full text, verdict, reason and where', async ({
    page,
    pool,
  }, testInfo) => {
    const { lessonId } = await createLesson(pool)
    await signIn(page, REVIEWER_1.email)
    await openEditor(page, lessonId)
    await fakeLlm.respond(
      {
        output: {
          standards: [
            {
              code: 'RL.6.1',
              verdict: 'addressed',
              reason: 'Students cite what the narrator says at two pause points.',
              evidence: ['b-pulse', 'part-a'],
            },
            {
              code: 'RL.6.2',
              verdict: 'missing',
              reason: 'No task asks students to name a theme or central idea.',
              evidence: ['part-b'],
            },
          ],
        },
      },
      {
        output: {
          standards: [
            { code: 'RL.6.1', verdict: 'addressed', reason: 'Still cited.', evidence: [] },
            {
              code: 'RL.6.2',
              verdict: 'partly_addressed',
              reason: 'Part B now hints at a central idea.',
              evidence: ['part-b'],
            },
          ],
        },
      },
    )

    await page.getByRole('button', { name: 'Alignment check' }).click()
    await expect(page.getByRole('tab', { name: 'Alignment' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const panel = page.getByRole('tabpanel', { name: 'Alignment' })
    await expect(panel.getByRole('heading', { name: 'Standards alignment' })).toBeVisible()
    await expect(
      panel.getByText(/The check suggests; it doesn[’']t change the lesson\./),
    ).toBeVisible()

    const items = panel.getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('RL.6.1')
    await expect(items.nth(0)).toContainText(standardText('RL.6.1'))
    await expect(items.nth(0)).toContainText('Addressed')
    await expect(items.nth(0)).toContainText(
      'Students cite what the narrator says at two pause points.',
    )
    await expect(items.nth(0).getByRole('link', { name: /Pulse check/ })).toBeVisible()
    await expect(items.nth(0).getByRole('link', { name: 'Part A', exact: true })).toBeVisible()
    await expect(items.nth(1)).toContainText('RL.6.2')
    await expect(items.nth(1)).toContainText(standardText('RL.6.2'))
    await expect(items.nth(1)).toContainText('Missing')
    await expect(items.nth(1).getByRole('link', { name: 'Part B' })).toBeVisible()
    await snap(page, testInfo, 'R22-alignment-check')
    await expectNoAxeViolations(page)

    const [request] = await fakeLlm.requests()
    expect(`${request!.system}\n${request!.prompt}`).toContain(standardText('RL.6.1'))
    expect(`${request!.system}\n${request!.prompt}`).toContain(standardText('RL.6.2'))

    await panel.getByRole('button', { name: 'Check again' }).click()
    await expect(items.nth(1)).toContainText('Partly addressed')
    await expect(items.nth(1)).toContainText('Part B now hints at a central idea.')
    expect(await fakeLlm.requests()).toHaveLength(2)

    // The check suggests and never edits.
    expect(await storedContent(pool, lessonId)).toEqual(richLessonContent())
    expect((await assistCalls(pool, lessonId)).map((call) => call.kind)).toEqual([
      'alignment',
      'alignment',
    ])
  })
})
