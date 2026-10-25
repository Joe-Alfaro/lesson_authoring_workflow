// M4 AI assist against the database with the fake LLM (no model provider is ever called):
// R20 selection actions, R21 regenerate one section, R22 standards alignment, metering against the
// global SPEND_CAP_USD, roles and the approved/generating lock. Contract: src/assist/README.md.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectTestDb } from '../../tests/db'
import {
  createFakeLlm,
  TEST_CALL_COST,
  TEST_MODEL,
  TEST_PRICES,
  type FakeRespond,
} from '../../tests/fake_llm'
import { richLessonContent, RICH_FOCUS } from '../../tests/fixtures/lesson/rich_lesson_fixture'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  type FixtureUser,
  type FixtureUsers,
} from '../../tests/workflow_fixtures'
import { runMigrations } from '../db/migrate'
import { generationRuns, lessonVersions, lessons, standards, type LessonStatus } from '../db/schema'
import { getCurrentPromptVersion } from '../generation/prompt_versions'
import { getTotalSpendUsd } from '../generation/service'
import { LessonContent, Section, type LessonContent as Lesson } from '../lesson/schema'
import { LessonLockedError, LessonNotFoundError, WorkflowForbiddenError } from '../workflow/errors'
import {
  AssistBudgetError,
  AssistInputError,
  AssistOutputError,
  SectionNotFoundError,
} from './errors'
import { checkAlignment, regenerateSection, suggestSelection, type AssistDeps } from './service'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'
const SAY_TEXT = 'Today we meet a narrator who says he is not a normal kid.'
const SUGGESTION = 'Today we meet a narrator who calls himself a problem kid.'
const CAP = 1

function standardRecords(): {
  code: string
  framework: 'CCSS_ELA'
  strand: string
  text: string
}[] {
  const file = resolve(import.meta.dirname, '../../data/standards/ccss_ela_grade6.json')
  const records = JSON.parse(readFileSync(file, 'utf8')) as {
    code: string
    framework: 'CCSS_ELA'
    strand: string
    text: string
  }[]
  return records.filter((record) => [...RICH_FOCUS, 'L.6.4'].includes(record.code))
}

function fullText(code: string): string {
  return standardRecords().find((record) => record.code === code)!.text
}

/** A proposed Look Back as the model might send it: wrong id and minutes, a colliding part id. */
function proposedLookBack(): unknown {
  return {
    section: {
      id: 'something-else',
      kind: 'look_back',
      minutes: 9,
      purpose: 'Students use a vocabulary word to reflect.',
      parts: [
        {
          id: 'b-say', // already used by the Launch Say block
          standards: [],
          blocks: [
            {
              type: 'reflection',
              id: 'b-new-reflection',
              prompt: 'Write one sentence that uses a vocabulary word from today.',
              questions: ['Which word did you choose, and why?'],
            },
          ],
        },
      ],
    },
  }
}

function alignmentOutput(): unknown {
  return {
    standards: [
      {
        code: 'RL.6.1',
        verdict: 'addressed',
        reason: 'Students cite what the narrator says at two pause points.',
        evidence: ['b-pulse', 'part-a', 'no-such-block'],
      },
      {
        code: 'RL.6.2',
        verdict: 'missing',
        reason: 'No task asks students to name a central idea.',
        evidence: ['part-b'],
      },
      // Not a focus standard of this lesson: dropped.
      { code: 'L.6.4', verdict: 'partly_addressed', reason: 'Word meaning only.', evidence: [] },
    ],
  }
}

function allIds(lesson: Lesson): string[] {
  return lesson.body.sections.flatMap((section) => [
    section.id!,
    ...section.parts.flatMap((part) => [part.id!, ...part.blocks.map((block) => block.id!)]),
  ])
}

describe('AI assist service', () => {
  const { pool, db } = connectTestDb()
  let people: FixtureUsers

  beforeAll(async () => {
    await runMigrations(pool)
    await db
      .insert(standards)
      .values(standardRecords().map((r) => ({ ...r, grade: 6 })))
      .onConflictDoNothing()
  })
  beforeEach(async () => {
    await cleanWorkflowData(db)
    await db.execute(sql`DELETE FROM assist_calls`)
    people = await createUsers(db)
  })
  afterAll(async () => {
    await db.execute(sql`DELETE FROM assist_calls`)
    await cleanWorkflowData(db)
    await pool.end()
  })

  async function lessonIn(
    status: LessonStatus = 'draft',
  ): Promise<{ unitId: string; lessonId: string }> {
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 4, status, content: richLessonContent() }],
    })
    return { unitId: unit.unitId, lessonId: unit.lessonIds[0]! }
  }

  function deps(respond: FakeRespond, extra: Partial<AssistDeps> = {}) {
    const llm = createFakeLlm({ respond })
    return {
      llm,
      deps: { db, llm, model: TEST_MODEL, prices: TEST_PRICES, globalCapUsd: CAP, ...extra },
    }
  }

  async function storedContent(lessonId: string) {
    const [row] = await db
      .select({ content: lessons.content, lastEditedBy: lessons.lastEditedBy })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
    return row!
  }

  async function versionCount(lessonId: string) {
    const rows = await db
      .select({ id: lessonVersions.id })
      .from(lessonVersions)
      .where(eq(lessonVersions.lessonId, lessonId))
    return rows.length
  }

  async function meteredCalls() {
    const result = await db.execute<{
      lesson_id: string | null
      user_id: string | null
      kind: string
      model: string
      tokens_in: number
      tokens_out: number
      cost_usd: string
    }>(
      sql`SELECT lesson_id, user_id, kind, model, tokens_in, tokens_out, cost_usd::text AS cost_usd
          FROM assist_calls ORDER BY created_at`,
    )
    return result.rows.map((row) => ({ ...row, cost_usd: Number(row.cost_usd) }))
  }

  async function spendRun(unitId: string, costUsd: number) {
    const promptVersion = await getCurrentPromptVersion(db, unitId)
    await db.insert(generationRuns).values({
      unitId,
      model: TEST_MODEL,
      promptVersionId: promptVersion.id,
      capUsd: 100,
      costUsd,
      status: 'completed',
    })
  }

  describe('suggestSelection (R20)', () => {
    it.each(['rewrite', 'shorten', 'simplify'] as const)(
      '%s returns a suggestion and changes nothing in the lesson',
      async (action) => {
        const { lessonId } = await lessonIn()
        const { llm, deps: d } = deps(() => ({ text: `  ${SUGGESTION}\n` }))
        const result = await suggestSelection(d, {
          lessonId,
          actor: people.reviewer,
          action,
          text: SAY_TEXT,
          blockId: 'b-say',
        })
        expect(result.suggestion).toBe(SUGGESTION)
        expect(llm.calls).toHaveLength(1)
        const request = llm.calls[0]!.request
        expect(request.model).toBe(TEST_MODEL)
        expect(`${request.system}\n${request.prompt}`).toContain(SAY_TEXT)
        // Nothing changes until the reviewer accepts in the editor.
        expect(await storedContent(lessonId)).toEqual({
          content: richLessonContent(),
          lastEditedBy: null,
        })
        expect(await versionCount(lessonId)).toBe(0)
      },
    )

    it('simplify targets the grade of the unit', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps(() => ({ text: SUGGESTION }))
      await suggestSelection(d, {
        lessonId,
        actor: people.reviewer,
        action: 'simplify',
        text: SAY_TEXT,
      })
      const request = llm.calls[0]!.request
      expect(`${request.system}\n${request.prompt}`).toMatch(/grade 6/i)
    })

    it('a free-form instruction is sent with the selection', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps(() => ({ text: SUGGESTION }))
      const instruction = 'Add a second example from page 3 and keep it under 3 sentences'
      await suggestSelection(d, {
        lessonId,
        actor: people.approver,
        action: 'instruction',
        text: SAY_TEXT,
        instruction,
      })
      const request = llm.calls[0]!.request
      expect(`${request.system}\n${request.prompt}`).toContain(instruction)
      expect(`${request.system}\n${request.prompt}`).toContain(SAY_TEXT)
    })

    it('rejects blank text, an unknown action and an instruction action without instruction', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps(() => ({ text: SUGGESTION }))
      const actor = people.reviewer
      await expect(
        suggestSelection(d, { lessonId, actor, action: 'rewrite', text: '   ' }),
      ).rejects.toBeInstanceOf(AssistInputError)
      await expect(
        suggestSelection(d, {
          lessonId,
          actor,
          action: 'instruction',
          text: SAY_TEXT,
          instruction: ' ',
        }),
      ).rejects.toBeInstanceOf(AssistInputError)
      await expect(
        // Not an action: a route body can carry anything.
        suggestSelection(d, { lessonId, actor, action: 'translate' as never, text: SAY_TEXT }),
      ).rejects.toBeInstanceOf(AssistInputError)
      expect(llm.calls).toHaveLength(0)
    })

    it('retries an invalid answer once, then fails with AssistOutputError; every call is metered', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps(() => ({ text: '' }))
      await expect(
        suggestSelection(d, {
          lessonId,
          actor: people.reviewer,
          action: 'rewrite',
          text: SAY_TEXT,
        }),
      ).rejects.toBeInstanceOf(AssistOutputError)
      expect(llm.calls).toHaveLength(2)
      expect(await meteredCalls()).toHaveLength(2)
      expect(await storedContent(lessonId)).toMatchObject({ content: richLessonContent() })
    })
  })

  describe('roles and locks', () => {
    const run = (d: AssistDeps, lessonId: string, actor: FixtureUser) => [
      () => suggestSelection(d, { lessonId, actor, action: 'rewrite', text: SAY_TEXT }),
      () => regenerateSection(d, { lessonId, actor, sectionId: 'sec-lookback' }),
      () => checkAlignment(d, { lessonId, actor }),
    ]

    it('authors are refused (reviewer and above only) and nothing is called', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps(() => ({ text: SUGGESTION }))
      for (const call of run(d, lessonId, people.author)) {
        await expect(call()).rejects.toBeInstanceOf(WorkflowForbiddenError)
      }
      expect(llm.calls).toHaveLength(0)
      expect(await meteredCalls()).toHaveLength(0)
    })

    it.each<LessonStatus>(['approved', 'generating'])(
      'a %s lesson is refused with LessonLockedError, even for an admin',
      async (status) => {
        const { lessonId } = await lessonIn(status)
        const { llm, deps: d } = deps(() => ({ text: SUGGESTION }))
        for (const call of run(d, lessonId, people.admin)) {
          await expect(call()).rejects.toBeInstanceOf(LessonLockedError)
        }
        expect(llm.calls).toHaveLength(0)
      },
    )

    it.each<LessonStatus>(['draft', 'in_review', 'changes_requested'])(
      'reviewers, approvers and admins can use assist on a %s lesson',
      async (status) => {
        const { lessonId } = await lessonIn(status)
        for (const actor of [people.reviewer, people.approver, people.admin]) {
          const { deps: d } = deps(() => ({ text: SUGGESTION }))
          await expect(
            suggestSelection(d, { lessonId, actor, action: 'shorten', text: SAY_TEXT }),
          ).resolves.toMatchObject({ suggestion: SUGGESTION })
        }
      },
    )

    it('an unknown or malformed lesson id is LessonNotFoundError', async () => {
      const { deps: d } = deps(() => ({ text: SUGGESTION }))
      for (const lessonId of [MISSING_ID, 'not-a-uuid']) {
        await expect(
          suggestSelection(d, {
            lessonId,
            actor: people.reviewer,
            action: 'rewrite',
            text: SAY_TEXT,
          }),
        ).rejects.toBeInstanceOf(LessonNotFoundError)
      }
    })
  })

  describe('regenerateSection (R21)', () => {
    it('returns a schema-valid section that replaces only that section, and saves nothing', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps(() => proposedLookBack())
      const instruction = "Have students use one of today's vocabulary words in the Quick Write."
      const { section } = await regenerateSection(d, {
        lessonId,
        actor: people.reviewer,
        sectionId: 'sec-lookback',
        instruction,
      })

      expect(Section.safeParse(section).success).toBe(true)
      // Same place, same kind, same minutes (mockup: "Minutes stay at 5").
      expect(section).toMatchObject({ id: 'sec-lookback', kind: 'look_back', minutes: 5 })
      expect(section.parts[0]!.blocks[0]).toMatchObject({
        type: 'reflection',
        prompt: 'Write one sentence that uses a vocabulary word from today.',
      })

      // Swapped into the lesson it validates, and every id stays unique.
      const merged = richLessonContent()
      merged.body.sections = merged.body.sections.map((s) =>
        s.id === 'sec-lookback' ? section : s,
      )
      expect(LessonContent.safeParse(merged).success).toBe(true)
      const ids = allIds(merged)
      expect(new Set(ids).size).toBe(ids.length)

      // The prompt carries the instruction and the current section.
      const request = llm.calls[0]!.request
      const text = `${request.system}\n${request.prompt}`
      expect(text).toContain(instruction)
      expect(text).toContain('Rate yourself from 1 to 5.')

      // Nothing changes until the reviewer accepts in the editor.
      expect(await storedContent(lessonId)).toEqual({
        content: richLessonContent(),
        lastEditedBy: null,
      })
      expect(await versionCount(lessonId)).toBe(0)
    })

    it('the instruction is optional', async () => {
      const { lessonId } = await lessonIn()
      const { deps: d } = deps(() => proposedLookBack())
      await expect(
        regenerateSection(d, { lessonId, actor: people.approver, sectionId: 'sec-launch' }),
      ).resolves.toMatchObject({ section: { id: 'sec-launch', kind: 'launch', minutes: 5 } })
    })

    it('an unknown section id is SectionNotFoundError and calls nothing', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps(() => proposedLookBack())
      await expect(
        regenerateSection(d, { lessonId, actor: people.reviewer, sectionId: 'sec-nope' }),
      ).rejects.toBeInstanceOf(SectionNotFoundError)
      expect(llm.calls).toHaveLength(0)
    })

    it('an answer that is not a valid section is retried once, then AssistOutputError', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps(() => ({ section: { kind: 'look_back', parts: [] } }))
      await expect(
        regenerateSection(d, { lessonId, actor: people.reviewer, sectionId: 'sec-lookback' }),
      ).rejects.toBeInstanceOf(AssistOutputError)
      expect(llm.calls).toHaveLength(2)
      expect(await storedContent(lessonId)).toMatchObject({ content: richLessonContent() })
    })
  })

  describe('checkAlignment (R22)', () => {
    it('lists each focus standard in order with its full text, verdict, reason and evidence', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps(() => alignmentOutput())
      const result = await checkAlignment(d, { lessonId, actor: people.reviewer })

      expect(result.checkedAt).toBeInstanceOf(Date)
      expect(result.standards.map((s) => s.code)).toEqual(RICH_FOCUS)
      const [rl1, rl2] = result.standards
      expect(rl1).toMatchObject({
        code: 'RL.6.1',
        text: fullText('RL.6.1'),
        verdict: 'addressed',
        reason: 'Students cite what the narrator says at two pause points.',
      })
      // Unknown ids are dropped; labels name where the evidence is.
      expect(rl1!.evidence.map((e) => e.id)).toEqual(['b-pulse', 'part-a'])
      expect(rl1!.evidence[0]!.label).toContain('Pulse check')
      expect(rl1!.evidence[1]!.label).toBe('Part A')
      expect(rl2).toMatchObject({
        code: 'RL.6.2',
        text: fullText('RL.6.2'),
        verdict: 'missing',
        evidence: [{ id: 'part-b', label: 'Part B' }],
      })

      // The model sees the full text of every focus standard and the lesson itself.
      const request = llm.calls[0]!.request
      const text = `${request.system}\n${request.prompt}`
      for (const code of RICH_FOCUS) {
        expect(text).toContain(code)
        expect(text).toContain(fullText(code))
      }
      expect(text).toContain('Mark any sentence where the narrator tells you how he feels.')

      // The check suggests; it doesn't change the lesson.
      expect(await storedContent(lessonId)).toEqual({
        content: richLessonContent(),
        lastEditedBy: null,
      })
    })

    it('an answer missing a focus standard or with an unknown verdict is retried, then AssistOutputError', async () => {
      const { lessonId } = await lessonIn()
      const { llm, deps: d } = deps((_request, call) =>
        call.index === 0
          ? { standards: [{ code: 'RL.6.1', verdict: 'addressed', reason: 'ok', evidence: [] }] }
          : {
              standards: [
                { code: 'RL.6.1', verdict: 'great', reason: 'ok', evidence: [] },
                { code: 'RL.6.2', verdict: 'missing', reason: 'no', evidence: [] },
              ],
            },
      )
      await expect(checkAlignment(d, { lessonId, actor: people.reviewer })).rejects.toBeInstanceOf(
        AssistOutputError,
      )
      expect(llm.calls).toHaveLength(2)
    })
  })

  describe('metering and the global budget', () => {
    it('records tokens and cost of every call, by kind, lesson and user', async () => {
      const { lessonId } = await lessonIn()
      const select = deps(() => ({ text: SUGGESTION })).deps
      await suggestSelection(select, {
        lessonId,
        actor: people.reviewer,
        action: 'rewrite',
        text: SAY_TEXT,
      })
      await suggestSelection(select, {
        lessonId,
        actor: people.reviewer,
        action: 'instruction',
        text: SAY_TEXT,
        instruction: 'Shorter.',
      })
      await regenerateSection(deps(() => proposedLookBack()).deps, {
        lessonId,
        actor: people.approver,
        sectionId: 'sec-lookback',
      })
      await checkAlignment(deps(() => alignmentOutput()).deps, { lessonId, actor: people.reviewer })

      const calls = await meteredCalls()
      expect(calls.map((c) => c.kind)).toEqual(['rewrite', 'instruction', 'section', 'alignment'])
      for (const call of calls) {
        expect(call).toMatchObject({
          lesson_id: lessonId,
          model: TEST_MODEL,
          tokens_in: 1000,
          tokens_out: 1000,
          cost_usd: TEST_CALL_COST,
        })
      }
      expect(calls[2]!.user_id).toBe(people.approver.id)
      expect(calls[0]!.user_id).toBe(people.reviewer.id)
    })

    it('assist spend counts in the global total that generation checks too', async () => {
      const { unitId, lessonId } = await lessonIn()
      await spendRun(unitId, 0.25)
      const { deps: d } = deps(() => ({ text: SUGGESTION }))
      await suggestSelection(d, {
        lessonId,
        actor: people.reviewer,
        action: 'rewrite',
        text: SAY_TEXT,
      })
      await suggestSelection(d, {
        lessonId,
        actor: people.reviewer,
        action: 'shorten',
        text: SAY_TEXT,
      })
      expect(await getTotalSpendUsd(db)).toBeCloseTo(0.25 + 2 * TEST_CALL_COST, 6)
    })

    it('assist spend is kept when its lesson is deleted', async () => {
      const { lessonId } = await lessonIn()
      const { deps: d } = deps(() => ({ text: SUGGESTION }))
      await suggestSelection(d, {
        lessonId,
        actor: people.reviewer,
        action: 'rewrite',
        text: SAY_TEXT,
      })
      await cleanWorkflowData(db)
      expect(await getTotalSpendUsd(db)).toBeCloseTo(TEST_CALL_COST, 6)
    })

    it('is refused with a clear message once the global budget is used up, and calls nothing', async () => {
      const { unitId, lessonId } = await lessonIn()
      await spendRun(unitId, CAP) // generation spent the whole SPEND_CAP_USD
      const { llm, deps: d } = deps(() => ({ text: SUGGESTION }))
      const attempts = [
        () =>
          suggestSelection(d, {
            lessonId,
            actor: people.reviewer,
            action: 'rewrite',
            text: SAY_TEXT,
          }),
        () => regenerateSection(d, { lessonId, actor: people.reviewer, sectionId: 'sec-lookback' }),
        () => checkAlignment(d, { lessonId, actor: people.reviewer }),
      ]
      for (const attempt of attempts) {
        const error = await attempt().catch((e: unknown) => e)
        expect(error).toBeInstanceOf(AssistBudgetError)
        expect((error as Error).message).toBe(
          'AI budget used up: $1.00 of the $1.00 spend cap is spent. Ask an admin to raise SPEND_CAP_USD.',
        )
      }
      expect(llm.calls).toHaveLength(0)
      expect(await meteredCalls()).toHaveLength(0)
    })

    it('runs while some budget remains', async () => {
      const { unitId, lessonId } = await lessonIn()
      await spendRun(unitId, CAP - 0.05)
      const { deps: d } = deps(() => ({ text: SUGGESTION }))
      await expect(
        suggestSelection(d, {
          lessonId,
          actor: people.reviewer,
          action: 'rewrite',
          text: SAY_TEXT,
        }),
      ).resolves.toMatchObject({ suggestion: SUGGESTION })
    })

    it('the cap defaults to SPEND_CAP_USD', async () => {
      const { unitId, lessonId } = await lessonIn()
      await spendRun(unitId, 3)
      const previous = process.env.SPEND_CAP_USD
      process.env.SPEND_CAP_USD = '3'
      try {
        const { deps: d } = deps(() => ({ text: SUGGESTION }), { globalCapUsd: undefined })
        await expect(
          suggestSelection(d, {
            lessonId,
            actor: people.reviewer,
            action: 'rewrite',
            text: SAY_TEXT,
          }),
        ).rejects.toBeInstanceOf(AssistBudgetError)
      } finally {
        if (previous === undefined) delete process.env.SPEND_CAP_USD
        else process.env.SPEND_CAP_USD = previous
      }
    })
  })
})
