// M4 AI assist routes (R20-R22) with the real requireRole against a mocked session and the fake
// LLM behind a mocked provider (no model provider is ever called). Contract: src/assist/README.md.
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { createFakeLlm, TEST_USAGE, type FakeLlm, type FakeRespond } from '../../../tests/fake_llm'
import { richLessonContent } from '../../../tests/fixtures/lesson/rich_lesson_fixture'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  type FixtureUser,
  type FixtureUsers,
} from '../../../tests/workflow_fixtures'
import type { LessonStatus } from '../../db/schema'
import { computeCostUsd, DEFAULT_MODEL } from '../../generation/llm'

const { auth, provider } = vi.hoisted(() => ({
  auth: vi.fn(),
  provider: { current: null as null | { llm: unknown; model: string } },
}))
vi.mock('../../auth/auth', () => ({ auth }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  forbidden: () => {
    throw new Error('forbidden')
  },
}))
vi.mock('../../assist/provider', () => ({
  getAssistProvider: () => {
    if (!provider.current) throw new Error('test forgot to set the fake provider')
    return provider.current
  },
}))

const MISSING_ID = '00000000-0000-4000-8000-000000000000'
const SAY_TEXT = 'Today we meet a narrator who says he is not a normal kid.'
const SUGGESTION = 'Today we meet a narrator who calls himself a problem kid.'

interface Result {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

async function call(handler: () => Promise<Response>): Promise<Result> {
  try {
    const response = await handler()
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'forbidden') return { status: 403, body: null }
    if (message.startsWith('redirect:')) return { status: 307, body: null }
    throw error
  }
}

function signIn(user: FixtureUser | null) {
  auth.mockResolvedValue(
    user && {
      user: { id: user.id, email: `${user.id}@example.com`, name: user.name, role: user.role },
      expires: '2099-01-01T00:00:00.000Z',
    },
  )
}

function post(path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function params<T>(value: T) {
  return { params: Promise.resolve(value) }
}

function useFake(respond: FakeRespond): FakeLlm {
  const llm = createFakeLlm({ respond })
  provider.current = { llm, model: DEFAULT_MODEL }
  return llm
}

describe('AI assist API', () => {
  let routes: {
    selection: typeof import('./lessons/[id]/assist/selection/route')
    section: typeof import('./lessons/[id]/assist/section/route')
    alignment: typeof import('./lessons/[id]/assist/alignment/route')
  }
  let db: import('../../db/client').Database
  let people: FixtureUsers
  const previousCap = process.env.SPEND_CAP_USD

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    process.env.SPEND_CAP_USD = '1'
    const client = await import('../../db/client')
    const { runMigrations } = await import('../../db/migrate')
    await runMigrations(client.getPool())
    db = client.getDb()
    routes = {
      selection: await import('./lessons/[id]/assist/selection/route'),
      section: await import('./lessons/[id]/assist/section/route'),
      alignment: await import('./lessons/[id]/assist/alignment/route'),
    }
  })
  beforeEach(async () => {
    auth.mockReset()
    provider.current = null
    await cleanWorkflowData(db)
    await db.execute(sql`DELETE FROM assist_calls`)
    people = await createUsers(db)
  })
  afterAll(async () => {
    if (previousCap === undefined) delete process.env.SPEND_CAP_USD
    else process.env.SPEND_CAP_USD = previousCap
    await db.execute(sql`DELETE FROM assist_calls`)
    await cleanWorkflowData(db)
    const { getPool } = await import('../../db/client')
    await getPool().end()
  })

  async function lessonIn(status: LessonStatus = 'draft') {
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 4, status, content: richLessonContent() }],
    })
    return unit.lessonIds[0]!
  }

  function selection(lessonId: string, body: unknown) {
    return call(() =>
      routes.selection.POST(
        post(`/api/lessons/${lessonId}/assist/selection`, body),
        params({ id: lessonId }),
      ),
    )
  }
  function section(lessonId: string, body: unknown) {
    return call(() =>
      routes.section.POST(
        post(`/api/lessons/${lessonId}/assist/section`, body),
        params({ id: lessonId }),
      ),
    )
  }
  function alignment(lessonId: string) {
    return call(() =>
      routes.alignment.POST(
        post(`/api/lessons/${lessonId}/assist/alignment`),
        params({ id: lessonId }),
      ),
    )
  }

  describe('POST /api/lessons/:id/assist/selection (R20)', () => {
    it('answers 200 with the suggestion and meters the call', async () => {
      const lessonId = await lessonIn()
      const llm = useFake(() => ({ text: SUGGESTION }))
      signIn(people.reviewer)
      expect(
        await selection(lessonId, { action: 'rewrite', text: SAY_TEXT, blockId: 'b-say' }),
      ).toEqual({
        status: 200,
        body: { suggestion: SUGGESTION },
      })
      expect(llm.calls[0]!.request.model).toBe(DEFAULT_MODEL)
      const rows = await db.execute<{ kind: string; cost_usd: string; user_id: string }>(
        sql`SELECT kind, cost_usd::text AS cost_usd, user_id FROM assist_calls`,
      )
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]!.kind).toBe('rewrite')
      expect(rows.rows[0]!.user_id).toBe(people.reviewer.id)
      expect(Number(rows.rows[0]!.cost_usd)).toBeCloseTo(
        computeCostUsd(DEFAULT_MODEL, TEST_USAGE),
        6,
      )
    })

    it('answers 400 for a bad body: blank text, unknown action, instruction without text', async () => {
      const lessonId = await lessonIn()
      const llm = useFake(() => ({ text: SUGGESTION }))
      signIn(people.reviewer)
      for (const body of [
        {},
        { action: 'rewrite', text: '  ' },
        { action: 'translate', text: SAY_TEXT },
        { action: 'instruction', text: SAY_TEXT },
      ]) {
        const result = await selection(lessonId, body)
        expect(result.status).toBe(400)
        expect(result.body).toEqual({ error: expect.any(String) })
      }
      expect(llm.calls).toHaveLength(0)
    })

    it('answers 403 for an author and 307 without a session (R27)', async () => {
      const lessonId = await lessonIn()
      const llm = useFake(() => ({ text: SUGGESTION }))
      signIn(people.author)
      expect((await selection(lessonId, { action: 'rewrite', text: SAY_TEXT })).status).toBe(403)
      signIn(null)
      expect((await selection(lessonId, { action: 'rewrite', text: SAY_TEXT })).status).toBe(307)
      expect(llm.calls).toHaveLength(0)
    })

    it('answers 409 on an approved or generating lesson and 404 for an unknown one', async () => {
      useFake(() => ({ text: SUGGESTION }))
      signIn(people.approver)
      for (const status of ['approved', 'generating'] as const) {
        const lessonId = await lessonIn(status)
        const result = await selection(lessonId, { action: 'rewrite', text: SAY_TEXT })
        expect(result.status).toBe(409)
        expect(result.body).toEqual({ error: expect.any(String) })
      }
      expect((await selection(MISSING_ID, { action: 'rewrite', text: SAY_TEXT })).status).toBe(404)
    })

    it('answers 402 with the budget message once SPEND_CAP_USD is spent', async () => {
      const lessonId = await lessonIn()
      await db.execute(
        sql`INSERT INTO assist_calls (lesson_id, kind, model, tokens_in, tokens_out, cost_usd)
            VALUES (${lessonId}, 'rewrite', ${DEFAULT_MODEL}, 0, 0, 1)`,
      )
      const llm = useFake(() => ({ text: SUGGESTION }))
      signIn(people.reviewer)
      expect(await selection(lessonId, { action: 'rewrite', text: SAY_TEXT })).toEqual({
        status: 402,
        body: {
          error:
            'AI budget used up: $1.00 of the $1.00 spend cap is spent. Ask an admin to raise SPEND_CAP_USD.',
        },
      })
      expect(llm.calls).toHaveLength(0)
    })

    it('answers 502 when the model keeps answering nonsense', async () => {
      const lessonId = await lessonIn()
      useFake(() => ({ nope: true }))
      signIn(people.reviewer)
      const result = await selection(lessonId, { action: 'shorten', text: SAY_TEXT })
      expect(result.status).toBe(502)
      expect(result.body).toEqual({ error: expect.any(String) })
    })
  })

  describe('POST /api/lessons/:id/assist/section (R21)', () => {
    it('answers 200 with the proposed section, keeping id and minutes', async () => {
      const lessonId = await lessonIn()
      useFake(() => ({
        section: {
          kind: 'look_back',
          minutes: 5,
          purpose: 'Reflect with a vocabulary word.',
          parts: [
            {
              standards: [],
              blocks: [{ type: 'say', text: 'Use one of today’s words in your Quick Write.' }],
            },
          ],
        },
      }))
      signIn(people.reviewer)
      const result = await section(lessonId, {
        sectionId: 'sec-lookback',
        instruction: 'Use vocabulary.',
      })
      expect(result.status).toBe(200)
      expect(result.body.section).toMatchObject({
        id: 'sec-lookback',
        kind: 'look_back',
        minutes: 5,
        parts: [
          { blocks: [{ type: 'say', text: 'Use one of today’s words in your Quick Write.' }] },
        ],
      })
      // Fresh ids for the new parts and blocks.
      expect(result.body.section.parts[0].id).toEqual(expect.any(String))
      expect(result.body.section.parts[0].blocks[0].id).toEqual(expect.any(String))
    })

    it('answers 404 for an unknown section and 400 without a sectionId', async () => {
      const lessonId = await lessonIn()
      useFake(() => ({ section: {} }))
      signIn(people.reviewer)
      expect((await section(lessonId, { sectionId: 'sec-nope' })).status).toBe(404)
      expect((await section(lessonId, {})).status).toBe(400)
    })

    it('answers 403 for an author', async () => {
      const lessonId = await lessonIn()
      useFake(() => ({ section: {} }))
      signIn(people.author)
      expect((await section(lessonId, { sectionId: 'sec-lookback' })).status).toBe(403)
    })
  })

  describe('POST /api/lessons/:id/assist/alignment (R22)', () => {
    it('answers 200 with one entry per focus standard and an ISO checkedAt', async () => {
      const lessonId = await lessonIn()
      useFake(() => ({
        standards: [
          {
            code: 'RL.6.1',
            verdict: 'addressed',
            reason: 'Cites evidence.',
            evidence: ['b-pulse'],
          },
          {
            code: 'RL.6.2',
            verdict: 'partly_addressed',
            reason: 'Theme only implied.',
            evidence: [],
          },
        ],
      }))
      signIn(people.approver)
      const result = await alignment(lessonId)
      expect(result.status).toBe(200)
      expect(new Date(result.body.checkedAt).toISOString()).toBe(result.body.checkedAt)
      expect(
        result.body.standards.map((s: { code: string; verdict: string }) => [s.code, s.verdict]),
      ).toEqual([
        ['RL.6.1', 'addressed'],
        ['RL.6.2', 'partly_addressed'],
      ])
    })

    it('answers 403 for an author and 409 on an approved lesson', async () => {
      useFake(() => ({ standards: [] }))
      signIn(people.author)
      expect((await alignment(await lessonIn())).status).toBe(403)
      signIn(people.reviewer)
      expect((await alignment(await lessonIn('approved'))).status).toBe(409)
    })
  })
})
