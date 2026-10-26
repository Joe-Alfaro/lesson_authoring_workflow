// The generation and prompt routes behind the unit dashboard and prompt editor (R6, R10-R12,
// D-024): role checks (authors and admins generate and edit prompts; only admins raise a cap),
// JSON `{ error }` answers and the happy paths. The real requireRole runs against a mocked
// session; pg-boss is replaced by a recorder, so no job runs and no model is called.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { createTestUnit, type TestUnit } from '../../../tests/generation_fixtures'
import {
  cleanWorkflowData,
  createUsers,
  type FixtureUser,
  type FixtureUsers,
} from '../../../tests/workflow_fixtures'

const { auth, insert } = vi.hoisted(() => ({ auth: vi.fn(), insert: vi.fn() }))
vi.mock('../../auth/auth', () => ({ auth }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  forbidden: () => {
    throw new Error('forbidden')
  },
}))
vi.mock('../../generation_api/boss', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../generation_api/boss')>()
  const { getDb } = await import('../../db/client')
  const boss = { insert } as unknown as import('pg-boss').PgBoss
  return {
    ...original,
    getAppBoss: async () => boss,
    generationDeps: async () => ({ db: getDb(), boss }),
  }
})

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

interface Result {
  status: number
  type: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

/** Runs a handler; role checks answer JSON themselves (D-032 (4)), so nothing is thrown. */
async function call(handler: () => Promise<Response>): Promise<Result> {
  const response = await handler()
  const text = await response.text()
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    body: text ? JSON.parse(text) : null,
  }
}

/** A role refusal: 403 with a JSON `{ error }`. */
const FORBIDDEN = {
  status: 403,
  type: expect.stringContaining('application/json'),
  body: { error: expect.any(String) },
}

function signIn(user: FixtureUser | null) {
  auth.mockResolvedValue(
    user && {
      user: { id: user.id, email: `${user.id}@example.com`, name: user.name, role: user.role },
      expires: '2099-01-01T00:00:00.000Z',
    },
  )
}

function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function params<T>(value: T) {
  return { params: Promise.resolve(value) }
}

describe('generation and prompt API', () => {
  let routes: {
    runs: typeof import('./units/[id]/generation/runs/route')
    estimate: typeof import('./units/[id]/generation/estimate/route')
    regenerate: typeof import('./units/[id]/generation/regenerate/route')
    cancel: typeof import('./generation/runs/[runId]/cancel/route')
    cap: typeof import('./generation/runs/[runId]/cap/route')
    resume: typeof import('./generation/runs/[runId]/resume/route')
    flex: typeof import('./lessons/[id]/generate/route')
    prompts: typeof import('./units/[id]/prompt-versions/route')
    prompt: typeof import('./units/[id]/prompt-versions/[versionId]/route')
  }
  let db: import('../../db/client').Database
  let schema: typeof import('../../db/schema')
  let promptVersions: typeof import('../../generation/prompt_versions')
  let people: FixtureUsers
  let unit: TestUnit

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    const client = await import('../../db/client')
    const { runMigrations } = await import('../../db/migrate')
    await runMigrations(client.getPool())
    db = client.getDb()
    schema = await import('../../db/schema')
    promptVersions = await import('../../generation/prompt_versions')
    routes = {
      runs: await import('./units/[id]/generation/runs/route'),
      estimate: await import('./units/[id]/generation/estimate/route'),
      regenerate: await import('./units/[id]/generation/regenerate/route'),
      cancel: await import('./generation/runs/[runId]/cancel/route'),
      cap: await import('./generation/runs/[runId]/cap/route'),
      resume: await import('./generation/runs/[runId]/resume/route'),
      flex: await import('./lessons/[id]/generate/route'),
      prompts: await import('./units/[id]/prompt-versions/route'),
      prompt: await import('./units/[id]/prompt-versions/[versionId]/route'),
    }
  })
  beforeEach(async () => {
    auth.mockReset()
    insert.mockReset()
    await cleanWorkflowData(db)
    people = await createUsers(db)
    unit = await createTestUnit(db, { lessons: 3, flexAfter: [2] })
  })
  afterAll(async () => {
    await cleanWorkflowData(db)
    const { getPool } = await import('../../db/client')
    await getPool().end()
  })

  /** A run stopped by its $0.25 cap after costing $0.29: lesson 1 generated, 2 and 3 not. */
  async function stoppedRun(): Promise<string> {
    const version = await promptVersions.getCurrentPromptVersion(db, unit.unitId)
    const [run] = await db
      .insert(schema.generationRuns)
      .values({
        unitId: unit.unitId,
        model: 'claude-haiku-5-5',
        promptVersionId: version.id,
        capUsd: 0.25,
        costUsd: 0.29,
        status: 'stopped_cap',
        finishedAt: new Date(),
      })
      .returning({ id: schema.generationRuns.id })
    await db.insert(schema.generationJobs).values([
      { runId: run!.id, lessonId: unit.lessonIds[0]!, status: 'generated', costUsd: 0.29 },
      { runId: run!.id, lessonId: unit.lessonIds[1]!, status: 'cancelled' },
      { runId: run!.id, lessonId: unit.lessonIds[2]!, status: 'cancelled' },
    ])
    await db
      .update(schema.lessons)
      .set({ content: { body: { title: 'Lesson 1' } } })
      .where(eq(schema.lessons.id, unit.lessonIds[0]!))
    return run!.id
  }

  describe('role checks (R27)', () => {
    it('lets only authors and admins start, estimate, regenerate, cancel or resume runs', async () => {
      const runId = await stoppedRun()
      for (const user of [people.reviewer, people.approver]) {
        signIn(user)
        const unitParams = params({ id: unit.unitId })
        const runParams = params({ runId })
        const answers = await Promise.all([
          call(() => routes.runs.POST(request('/', 'POST', {}), unitParams)),
          call(() => routes.estimate.GET(request('/'), unitParams)),
          call(() => routes.regenerate.POST(request('/', 'POST', { failed: true }), unitParams)),
          call(() => routes.cancel.POST(request('/', 'POST'), runParams)),
          call(() => routes.resume.POST(request('/', 'POST'), runParams)),
          call(() => routes.flex.POST(request('/', 'POST', {}), params({ id: unit.flexIds[0]! }))),
        ])
        expect(answers).toEqual(Array.from({ length: 6 }, () => FORBIDDEN))
      }
      expect(insert).not.toHaveBeenCalled()
    })

    it('lets only authors and admins read and save prompt versions', async () => {
      signIn(people.reviewer)
      const unitParams = params({ id: unit.unitId })
      expect(await call(() => routes.prompts.GET(request('/'), unitParams))).toEqual(FORBIDDEN)
      expect(
        await call(() =>
          routes.prompts.POST(request('/', 'POST', { template: { system: 'x' } }), unitParams),
        ),
      ).toEqual(FORBIDDEN)
    })

    it('lets only admins raise a run cap', async () => {
      const runId = await stoppedRun()
      for (const user of [people.author, people.approver, people.reviewer]) {
        signIn(user)
        const answer = await call(() =>
          routes.cap.PUT(request('/', 'PUT', { capUsd: 1 }), params({ runId })),
        )
        expect(answer).toEqual(FORBIDDEN)
      }
    })

    it('answers a signed-out caller 401 JSON', async () => {
      signIn(null)
      const answer = await call(() =>
        routes.runs.POST(request('/', 'POST', {}), params({ id: unit.unitId })),
      )
      expect(answer).toMatchObject({ status: 401, body: { error: 'Sign in required' } })
    })
  })

  describe('runs (R6, R12)', () => {
    it('starts a run of every numbered lesson and queues one job each', async () => {
      signIn(people.author)
      const answer = await call(() =>
        routes.runs.POST(request('/', 'POST', {}), params({ id: unit.unitId })),
      )
      expect(answer.status).toBe(201)
      expect(answer.body).toMatchObject({ jobCount: 3 })
      expect(insert).toHaveBeenCalledTimes(1)
      const [run] = await db
        .select()
        .from(schema.generationRuns)
        .where(eq(schema.generationRuns.id, answer.body.runId))
      expect(run).toMatchObject({ createdBy: people.author.id, model: 'claude-haiku-5-5' })
    })

    it('starts a run of the given lessons on the chosen model', async () => {
      signIn(people.admin)
      const answer = await call(() =>
        routes.runs.POST(
          request('/', 'POST', { model: 'claude-sonnet-5-5', lessonIds: [unit.lessonIds[1]] }),
          params({ id: unit.unitId }),
        ),
      )
      expect(answer.status).toBe(201)
      expect(answer.body.jobCount).toBe(1)
    })

    it('answers 404 for an unknown unit and 400 for an unknown model or a bad body', async () => {
      signIn(people.author)
      const missing = await call(() =>
        routes.runs.POST(request('/', 'POST', {}), params({ id: MISSING_ID })),
      )
      expect(missing.status).toBe(404)
      expect(missing.body.error).toEqual(expect.any(String))
      const model = await call(() =>
        routes.runs.POST(
          request('/', 'POST', { model: 'no-such-model' }),
          params({ id: unit.unitId }),
        ),
      )
      expect(model.status).toBe(400)
      expect(model.body.error).toContain('no-such-model')
      const body = await call(() =>
        routes.runs.POST(request('/', 'POST', { lessonIds: 'all' }), params({ id: unit.unitId })),
      )
      expect(body.status).toBe(400)
      expect(insert).not.toHaveBeenCalled()
    })

    it('answers 400 for an empty lesson list and creates no run', async () => {
      signIn(people.author)
      const answer = await call(() =>
        routes.runs.POST(request('/', 'POST', { lessonIds: [] }), params({ id: unit.unitId })),
      )
      expect(answer.status).toBe(400)
      expect(answer.body.error).toEqual(expect.any(String))
      expect(await db.select().from(schema.generationRuns)).toHaveLength(0)
    })

    it('estimates the cost of the numbered lessons', async () => {
      signIn(people.author)
      const answer = await call(() =>
        routes.estimate.GET(request('/?model=claude-haiku-5-5'), params({ id: unit.unitId })),
      )
      expect(answer.status).toBe(200)
      expect(answer.body.lessonCount).toBe(3)
      expect(answer.body.estimatedUsd).toBeCloseTo(answer.body.perLessonUsd * 3)
      expect(answer.body.perLessonUsd).toBeGreaterThan(0)
    })

    it('cancels a running run and answers 404 for an unknown one', async () => {
      signIn(people.author)
      const started = await call(() =>
        routes.runs.POST(request('/', 'POST', {}), params({ id: unit.unitId })),
      )
      const answer = await call(() =>
        routes.cancel.POST(request('/', 'POST'), params({ runId: started.body.runId })),
      )
      expect(answer).toMatchObject({ status: 200, body: { status: 'cancelled' } })
      const missing = await call(() =>
        routes.cancel.POST(request('/', 'POST'), params({ runId: 'not-a-run' })),
      )
      expect(missing.status).toBe(404)
    })

    it('generates a flex day on request, but not a numbered lesson', async () => {
      signIn(people.author)
      const flex = await call(() =>
        routes.flex.POST(request('/', 'POST', {}), params({ id: unit.flexIds[0]! })),
      )
      expect(flex.status).toBe(201)
      expect(flex.body.jobCount).toBe(1)
      const numbered = await call(() =>
        routes.flex.POST(request('/', 'POST', {}), params({ id: unit.lessonIds[0]! })),
      )
      expect(numbered.status).toBe(400)
    })
  })

  describe('regenerate (R11)', () => {
    it('asks to confirm lessons with human edits, then regenerates them', async () => {
      signIn(people.author)
      await db
        .update(schema.lessons)
        .set({ lastEditedBy: people.reviewer.id })
        .where(eq(schema.lessons.id, unit.lessonIds[0]!))
      const lessonIds = [unit.lessonIds[0], unit.lessonIds[1]]
      const first = await call(() =>
        routes.regenerate.POST(request('/', 'POST', { lessonIds }), params({ id: unit.unitId })),
      )
      expect(first.status).toBe(409)
      expect(first.body).toMatchObject({ reason: 'human_edits', lessonIds: [unit.lessonIds[0]] })
      expect(insert).not.toHaveBeenCalled()

      const confirmed = await call(() =>
        routes.regenerate.POST(
          request('/', 'POST', { lessonIds, confirmOverwrite: true }),
          params({ id: unit.unitId }),
        ),
      )
      expect(confirmed.status).toBe(201)
      expect(confirmed.body.jobCount).toBe(2)
    })

    it('needs lessons or "failed"', async () => {
      signIn(people.author)
      const answer = await call(() =>
        routes.regenerate.POST(request('/', 'POST', {}), params({ id: unit.unitId })),
      )
      expect(answer.status).toBe(400)
    })
  })

  describe('spend cap and resume (R12, D-024)', () => {
    it('keeps a raised cap inside the global budget', async () => {
      const runId = await stoppedRun()
      signIn(people.admin)
      const tooHigh = await call(() =>
        routes.cap.PUT(request('/', 'PUT', { capUsd: 25 }), params({ runId })),
      )
      expect(tooHigh.status).toBe(400)
      expect(tooHigh.body.error).toContain('$20.00')
      const notAboveCost = await call(() =>
        routes.cap.PUT(request('/', 'PUT', { capUsd: 0.2 }), params({ runId })),
      )
      expect(notAboveCost.status).toBe(400)
      const notNumber = await call(() =>
        routes.cap.PUT(request('/', 'PUT', { capUsd: '1' }), params({ runId })),
      )
      expect(notNumber.status).toBe(400)

      const ok = await call(() =>
        routes.cap.PUT(request('/', 'PUT', { capUsd: 1 }), params({ runId })),
      )
      expect(ok).toMatchObject({ status: 200, body: { capUsd: 1 } })
      const [run] = await db
        .select()
        .from(schema.generationRuns)
        .where(eq(schema.generationRuns.id, runId))
      expect(run!.capUsd).toBe(1)
    })

    it('raises only a run stopped by its cap', async () => {
      signIn(people.author)
      const started = await call(() =>
        routes.runs.POST(request('/', 'POST', {}), params({ id: unit.unitId })),
      )
      signIn(people.admin)
      const answer = await call(() =>
        routes.cap.PUT(request('/', 'PUT', { capUsd: 1 }), params({ runId: started.body.runId })),
      )
      expect(answer.status).toBe(409)
    })

    it('resumes only after the cap is raised, with only the lessons that were not generated', async () => {
      const runId = await stoppedRun()
      signIn(people.author)
      const early = await call(() => routes.resume.POST(request('/', 'POST'), params({ runId })))
      expect(early.status).toBe(409)
      expect(insert).not.toHaveBeenCalled()

      signIn(people.admin)
      await call(() => routes.cap.PUT(request('/', 'PUT', { capUsd: 1 }), params({ runId })))
      signIn(people.author)
      const resumed = await call(() => routes.resume.POST(request('/', 'POST'), params({ runId })))
      expect(resumed.status).toBe(201)
      expect(resumed.body.jobCount).toBe(2)
      const jobs = await db
        .select({ lessonId: schema.generationJobs.lessonId })
        .from(schema.generationJobs)
        .where(eq(schema.generationJobs.runId, resumed.body.runId))
      expect(jobs.map((job) => job.lessonId).sort()).toEqual(
        [unit.lessonIds[1], unit.lessonIds[2]].sort(),
      )
      const [run] = await db
        .select()
        .from(schema.generationRuns)
        .where(eq(schema.generationRuns.id, resumed.body.runId))
      // The new run gets what is left under the raised cap: $1.00 - $0.29.
      expect(run!.capUsd).toBeCloseTo(0.71)
    })
  })

  describe('prompt versions (R10)', () => {
    it('lists the versions, saves the next one and reads one back', async () => {
      signIn(people.author)
      const unitParams = params({ id: unit.unitId })
      const list = await call(() => routes.prompts.GET(request('/'), unitParams))
      expect(list.status).toBe(200)
      expect(list.body.versions.map((v: { version: number }) => v.version)).toEqual([1])

      const template = { ...list.body.versions[0].template, system: 'New system instructions.' }
      const saved = await call(() =>
        routes.prompts.POST(request('/', 'POST', { template }), unitParams),
      )
      expect(saved.status).toBe(201)
      expect(saved.body).toMatchObject({ version: 2, createdBy: people.author.id })

      const one = await call(() =>
        routes.prompt.GET(request('/'), params({ id: unit.unitId, versionId: saved.body.id })),
      )
      expect(one.status).toBe(200)
      expect(one.body.template.system).toBe('New system instructions.')
    })

    it('rejects an invalid template and stores nothing', async () => {
      signIn(people.author)
      const unitParams = params({ id: unit.unitId })
      const answer = await call(() =>
        routes.prompts.POST(
          request('/', 'POST', { template: { system: '', styleGuide: '', typeGuidance: {} } }),
          unitParams,
        ),
      )
      expect(answer.status).toBe(400)
      expect(answer.body.error).toEqual(expect.any(String))
      expect(await promptVersions.listPromptVersions(db, unit.unitId)).toHaveLength(0)
    })

    it('answers 404 for an unknown unit or a version of another unit', async () => {
      signIn(people.author)
      expect(
        (await call(() => routes.prompts.GET(request('/'), params({ id: MISSING_ID })))).status,
      ).toBe(404)
      const other = await createTestUnit(db, { lessons: 1 })
      const version = await promptVersions.getCurrentPromptVersion(db, other.unitId)
      const answer = await call(() =>
        routes.prompt.GET(request('/'), params({ id: unit.unitId, versionId: version.id })),
      )
      expect(answer.status).toBe(404)
    })
  })
})
