// R16 export at the API level: a lesson or a whole unit as JSON (the lesson schema plus unit, arc
// and lesson metadata, standards and ids) and as standalone HTML; any signed-in role downloads.
// The real requireApiRole runs against a mocked session. Contract: src/export/README.md.
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { loadFixtureStandards } from '../../../tests/generation_fixtures'
import { coreLessonContent, flexLessonContent } from '../../../tests/fixtures/lesson/lesson_fixture'
import { richLessonContent } from '../../../tests/fixtures/lesson/rich_lesson_fixture'
import {
  cleanWorkflowData,
  createTestUnit,
  createUsers,
  lessonContent,
  type FixtureUser,
  type FixtureUsers,
} from '../../../tests/workflow_fixtures'
import { hasContentIds } from '../../lesson/content_ids'
import { LessonContent } from '../../lesson/schema'

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('../../auth/auth', () => ({ auth }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  forbidden: () => {
    throw new Error('forbidden')
  },
}))

const MISSING_ID = '00000000-0000-4000-8000-000000000000'
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const SAFE_FILE = /^attachment; filename="([a-z0-9][a-z0-9-]*)\.(json|html)"$/

interface Download {
  status: number
  headers: Headers
  text: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any
}

async function call(handler: () => Promise<Response>): Promise<Download> {
  const response = await handler()
  const text = await response.text()
  let json: unknown = null
  if ((response.headers.get('content-type') ?? '').includes('application/json') && text) {
    json = JSON.parse(text)
  }
  return { status: response.status, headers: response.headers, text, json }
}

function signIn(user: FixtureUser | null) {
  auth.mockResolvedValue(
    user && {
      user: { id: user.id, email: `${user.id}@example.com`, name: user.name, role: user.role },
      expires: '2099-01-01T00:00:00.000Z',
    },
  )
}

function params<T>(value: T) {
  return { params: Promise.resolve(value) }
}

/** Every code in the front matter and on parts (what lessonCodes in src/ui/lesson returns). */
function lessonCodes(content: LessonContent): string[] {
  const codes = new Set<string>([
    ...content.frontMatter.focusStandards,
    ...content.frontMatter.supportingStandards,
    ...content.frontMatter.eldStandards.map((eld) => eld.code),
  ])
  for (const section of content.body.sections) {
    for (const part of section.parts) part.standards.forEach((code) => codes.add(code))
  }
  return [...codes]
}

/** The HTML's text with tags removed and whitespace collapsed. */
function plain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
}

function fileName(download: Download): string {
  const match = SAFE_FILE.exec(download.headers.get('content-disposition') ?? '')
  expect(match, download.headers.get('content-disposition') ?? '(none)').not.toBeNull()
  return `${match![1]}.${match![2]}`
}

describe('export API (R16)', () => {
  let routes: {
    lesson: typeof import('./lessons/[id]/export/route')
    unit: typeof import('./units/[id]/export/route')
  }
  let db: import('../../db/client').Database
  let schema: typeof import('../../db/schema')
  let workflow: typeof import('../../workflow/service')
  let people: FixtureUsers

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    const client = await import('../../db/client')
    const { runMigrations } = await import('../../db/migrate')
    await runMigrations(client.getPool())
    db = client.getDb()
    schema = await import('../../db/schema')
    workflow = await import('../../workflow/service')
    await loadFixtureStandards(db)
    routes = {
      lesson: await import('./lessons/[id]/export/route'),
      unit: await import('./units/[id]/export/route'),
    }
  })
  beforeEach(async () => {
    auth.mockReset()
    await cleanWorkflowData(db)
    people = await createUsers(db)
  })
  afterAll(async () => {
    await cleanWorkflowData(db)
    const { getPool } = await import('../../db/client')
    await getPool().end()
  })

  function lessonExport(lessonId: string, format?: string) {
    const query = format === undefined ? '' : `?format=${format}`
    return call(() =>
      routes.lesson.GET(
        new Request(`http://localhost/api/lessons/${lessonId}/export${query}`),
        params({ id: lessonId }),
      ),
    )
  }

  function unitExport(unitId: string, format?: string) {
    const query = format === undefined ? '' : `?format=${format}`
    return call(() =>
      routes.unit.GET(
        new Request(`http://localhost/api/units/${unitId}/export${query}`),
        params({ id: unitId }),
      ),
    )
  }

  /** Lesson 4 with the rich fixture, moved to Approved by the approver through the workflow. */
  async function approvedLesson() {
    const unit = await createTestUnit(db, {
      lessons: [{ lessonNumber: 4, status: 'in_review', content: richLessonContent() }],
    })
    const lessonId = unit.lessonIds[0]!
    await workflow.transitionLesson(db, {
      lessonId,
      action: 'approve',
      actor: { id: people.approver.id, role: 'approver' },
    })
    return { ...unit, lessonId }
  }

  async function storedContent(lessonId: string): Promise<unknown> {
    const [row] = await db
      .select({ content: schema.lessons.content })
      .from(schema.lessons)
      .where(eq(schema.lessons.id, lessonId))
    return row?.content
  }

  describe('GET /api/lessons/:id/export', () => {
    it('downloads an approved lesson as JSON matching the lesson schema, with metadata and ids', async () => {
      const { unitId, arcIds, lessonId } = await approvedLesson()
      signIn(people.reviewer)
      const result = await lessonExport(lessonId, 'json')

      expect(result.status).toBe(200)
      expect(result.headers.get('content-type')).toMatch(/^application\/json; ?charset=utf-8$/i)
      expect(result.headers.get('cache-control')).toContain('no-store')
      expect(fileName(result)).toMatch(/^unit-4-lesson-4(-[a-z0-9-]+)?\.json$/)

      const body = result.json
      expect(body.exportVersion).toBe(1)
      expect(body.exportedAt).toMatch(ISO)
      expect(body.unit).toEqual({
        id: unitId,
        grade: 6,
        unitNumber: 4,
        anchorTextTitle: 'Placeholder Anchor Novel',
        isbn: null,
        arcs: [{ id: arcIds[0], name: 'Investigation 1', position: 0 }],
      })
      expect(body.lesson).toMatchObject({
        id: lessonId,
        unitId,
        number: 4,
        isFlex: false,
        position: 0,
        filename: 'L4_TE',
        lessonType: 'Core Reading',
        arc: { id: arcIds[0], name: 'Investigation 1', position: 0 },
        status: 'approved',
        approved: true,
        approval: { by: { id: people.approver.id, name: people.approver.name } },
      })
      expect(body.lesson.approval.at).toMatch(ISO)

      const parsed = LessonContent.safeParse(body.lesson.content)
      expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true)
      expect(body.lesson.content).toEqual(await storedContent(lessonId))
      expect(hasContentIds(parsed.data!)).toBe(true)
    })

    it('lists every standard the lesson uses once, with its reference text or null when unknown', async () => {
      const { lessonId } = await approvedLesson()
      signIn(people.author)
      const body = (await lessonExport(lessonId)).json
      const codes = lessonCodes(richLessonContent()).sort()
      const rows = await db
        .select()
        .from(schema.standards)
        .where(inArray(schema.standards.code, codes))
      const known = new Map(rows.map((row) => [row.code, row]))
      expect(known.has('RL.6.1')).toBe(true)

      expect(body.lesson.standards.map((s: { code: string }) => s.code)).toEqual(codes)
      for (const standard of body.lesson.standards) {
        const row = known.get(standard.code)
        if (row) {
          expect(standard).toMatchObject({
            code: row.code,
            framework: row.framework,
            text: row.text,
          })
          expect(typeof standard.strand).toBe('string')
        } else {
          expect(standard).toEqual({
            code: standard.code,
            framework: null,
            strand: null,
            text: null,
          })
        }
      }
    })

    it('defaults to JSON when no format is given', async () => {
      const { lessonId } = await approvedLesson()
      signIn(people.reviewer)
      const result = await lessonExport(lessonId)
      expect(result.status).toBe(200)
      expect(result.json.lesson.id).toBe(lessonId)
    })

    it('gives a lesson stored without ids section, part and block ids in the export', async () => {
      const unit = await createTestUnit(db, {
        lessons: [{ lessonNumber: 4, status: 'approved', content: coreLessonContent() }],
      })
      signIn(people.reviewer)
      const body = (await lessonExport(unit.lessonIds[0]!)).json
      const parsed = LessonContent.parse(body.lesson.content)
      expect(hasContentIds(parsed)).toBe(true)
      expect(parsed.body.title).toBe(coreLessonContent().body.title)
    })

    it('downloads an approved lesson as standalone HTML in the teacher-facing layout', async () => {
      const { lessonId } = await approvedLesson()
      signIn(people.reviewer)
      const result = await lessonExport(lessonId, 'html')

      expect(result.status).toBe(200)
      expect(result.headers.get('content-type')).toMatch(/^text\/html; ?charset=utf-8$/i)
      expect(fileName(result)).toMatch(/^unit-4-lesson-4(-[a-z0-9-]+)?\.html$/)
      const html = result.text
      expect(html.trimStart().slice(0, 15).toLowerCase()).toBe('<!doctype html>')
      expect(html).not.toMatch(/<script|<link|<img|<iframe|\ssrc=|@import|url\(/i)
      const text = plain(html)
      expect(text).toContain('Lesson 4: Placeholder Lesson: Every Block')
      expect(text).toContain('Focus standards')
      expect(text).toContain('Launch, 5 min')
      expect(text).toContain('Look Back, 5 min')
      expect(text).toContain(`Approved by ${people.approver.name}`)
      expect(text).not.toMatch(/not approved/i)
      expect(html).toContain('Sticky notes for &lt;annotation&gt;')
    })

    it('exports a lesson that is not approved, marked as not approved', async () => {
      const unit = await createTestUnit(db, {
        lessons: [{ lessonNumber: 4, status: 'draft', content: richLessonContent() }],
      })
      const lessonId = unit.lessonIds[0]!
      signIn(people.reviewer)

      const json = await lessonExport(lessonId, 'json')
      expect(json.status).toBe(200)
      expect(json.json.lesson).toMatchObject({ status: 'draft', approved: false, approval: null })
      expect(LessonContent.safeParse(json.json.lesson.content).success).toBe(true)

      const html = await lessonExport(lessonId, 'html')
      expect(html.status).toBe(200)
      expect(plain(html.text)).toContain('Not approved: Draft')
      expect(plain(html.text)).not.toContain('Approved by')
    })

    it('answers 409 with an error for a lesson without content or with invalid content', async () => {
      const unit = await createTestUnit(db, {
        lessons: [
          { lessonNumber: 1, status: 'draft', content: null },
          { lessonNumber: 2, status: 'approved', content: lessonContent('Not a full lesson') },
        ],
      })
      signIn(people.approver)
      for (const lessonId of unit.lessonIds) {
        for (const format of ['json', 'html']) {
          const result = await lessonExport(lessonId, format)
          expect(result.status).toBe(409)
          expect(result.json).toEqual({ error: expect.any(String) })
        }
      }
    })

    it('answers 404 with an error for an unknown or malformed lesson id', async () => {
      signIn(people.reviewer)
      for (const id of [MISSING_ID, 'not-a-uuid']) {
        const result = await lessonExport(id)
        expect(result.status).toBe(404)
        expect(result.json).toEqual({ error: expect.any(String) })
      }
    })

    it('answers 400 for an unknown format', async () => {
      const { lessonId } = await approvedLesson()
      signIn(people.reviewer)
      const result = await lessonExport(lessonId, 'xml')
      expect(result.status).toBe(400)
      expect(result.json).toEqual({ error: expect.any(String) })
    })
  })

  describe('GET /api/units/:id/export', () => {
    /**
     * Lessons 1-4 and a flex day in two arcs: 1, the flex day and 4 approved; 2 in review with
     * content; 3 never generated.
     */
    async function mixedUnit() {
      const unit = await createTestUnit(db, {
        arcs: ['Investigation 1', 'Investigation 2'],
        lessons: [
          { lessonNumber: 1, arc: 0, status: 'approved', content: richLessonContent() },
          { lessonNumber: 2, arc: 0, status: 'in_review', content: richLessonContent() },
          { lessonNumber: null, arc: 0, status: 'approved', content: flexLessonContent() },
          { lessonNumber: 3, arc: 1, status: 'draft', content: null },
          { lessonNumber: 4, arc: 1, status: 'approved', content: coreLessonContent() },
        ],
      })
      return unit
    }

    it('downloads the approved lessons as JSON with unit metadata, counts and the skipped lessons', async () => {
      const unit = await mixedUnit()
      signIn(people.reviewer)
      const result = await unitExport(unit.unitId, 'json')

      expect(result.status).toBe(200)
      expect(result.headers.get('content-type')).toMatch(/^application\/json; ?charset=utf-8$/i)
      expect(fileName(result)).toMatch(/^grade-6-unit-4(-[a-z0-9-]+)?\.json$/)
      const body = result.json
      expect(body.exportVersion).toBe(1)
      expect(body.exportedAt).toMatch(ISO)
      expect(body.unit).toEqual({
        id: unit.unitId,
        grade: 6,
        unitNumber: 4,
        anchorTextTitle: 'Placeholder Anchor Novel',
        isbn: null,
        arcs: [
          { id: unit.arcIds[0], name: 'Investigation 1', position: 0 },
          { id: unit.arcIds[1], name: 'Investigation 2', position: 1 },
        ],
      })
      expect(body.counts).toEqual({ total: 5, exported: 3, skipped: 2 })
      expect(body.lessons.map((lesson: { id: string }) => lesson.id)).toEqual([
        unit.lessonIds[0],
        unit.lessonIds[2],
        unit.lessonIds[4],
      ])
      expect(body.lessons.map((lesson: { number: number | null }) => lesson.number)).toEqual([
        1,
        null,
        4,
      ])
      expect(body.lessons[2].arc).toEqual({
        id: unit.arcIds[1],
        name: 'Investigation 2',
        position: 1,
      })
      for (const lesson of body.lessons) {
        expect(lesson).toMatchObject({ unitId: unit.unitId, status: 'approved', approved: true })
        const parsed = LessonContent.safeParse(lesson.content)
        expect(parsed.success).toBe(true)
        expect(hasContentIds(parsed.data!)).toBe(true)
        expect(Array.isArray(lesson.standards)).toBe(true)
      }
      expect(body.skipped).toEqual([
        { id: unit.lessonIds[1], number: 2, isFlex: false, status: 'in_review' },
        { id: unit.lessonIds[3], number: 3, isFlex: false, status: 'draft' },
      ])
    })

    it('answers 200 with no lessons when nothing is approved yet', async () => {
      const unit = await createTestUnit(db, {
        lessons: [{ lessonNumber: 1, status: 'draft', content: richLessonContent() }],
      })
      signIn(people.reviewer)
      const result = await unitExport(unit.unitId)
      expect(result.status).toBe(200)
      expect(result.json.lessons).toEqual([])
      expect(result.json.counts).toEqual({ total: 1, exported: 0, skipped: 1 })

      const html = await unitExport(unit.unitId, 'html')
      expect(html.status).toBe(200)
      expect(plain(html.text)).toContain('0 of 1 lessons approved and included')
    })

    it('downloads the unit as one HTML document with a table of contents', async () => {
      const unit = await mixedUnit()
      signIn(people.reviewer)
      const result = await unitExport(unit.unitId, 'html')

      expect(result.status).toBe(200)
      expect(result.headers.get('content-type')).toMatch(/^text\/html; ?charset=utf-8$/i)
      expect(fileName(result)).toMatch(/^grade-6-unit-4(-[a-z0-9-]+)?\.html$/)
      const html = result.text
      expect(html.trimStart().slice(0, 15).toLowerCase()).toBe('<!doctype html>')
      expect(html.match(/<html/gi)).toHaveLength(1)
      expect(html).not.toMatch(/<script|<link|<img|<iframe|\ssrc=|@import|url\(/i)
      expect(html).toMatch(/<nav[^>]*aria-label="Contents"/)
      expect(html.match(/<article/gi)).toHaveLength(3)
      const text = plain(html)
      expect(text).toContain('3 of 5 lessons approved and included')
      expect(text).toContain('Placeholder Lesson: Every Block')
      expect(text).toContain(flexLessonContent().body.title)
      expect(text).toContain(coreLessonContent().body.title)
      expect(text).not.toMatch(/not approved/i)
    })

    it('answers 404 with an error for an unknown or malformed unit id', async () => {
      signIn(people.author)
      for (const id of [MISSING_ID, 'not-a-uuid']) {
        const result = await unitExport(id)
        expect(result.status).toBe(404)
        expect(result.json).toEqual({ error: expect.any(String) })
      }
    })

    it('answers 400 for an unknown format', async () => {
      const unit = await mixedUnit()
      signIn(people.reviewer)
      expect((await unitExport(unit.unitId, 'pdf')).status).toBe(400)
    })
  })

  describe('roles (R27)', () => {
    it('lets every signed-in role download a lesson and a unit, as JSON and HTML', async () => {
      const { unitId, lessonId } = await approvedLesson()
      for (const user of [people.author, people.reviewer, people.approver, people.admin]) {
        signIn(user)
        for (const format of ['json', 'html']) {
          expect((await lessonExport(lessonId, format)).status, `${user.role} ${format}`).toBe(200)
          expect((await unitExport(unitId, format)).status, `${user.role} ${format}`).toBe(200)
        }
      }
    })

    it('answers 401 JSON without a session', async () => {
      const { unitId, lessonId } = await approvedLesson()
      signIn(null)
      for (const result of [
        await lessonExport(lessonId, 'json'),
        await lessonExport(lessonId, 'html'),
        await unitExport(unitId, 'json'),
        await unitExport(unitId, 'html'),
      ]) {
        expect(result.status).toBe(401)
        expect(result.json).toEqual({ error: expect.any(String) })
        expect(result.headers.get('content-disposition')).toBeNull()
      }
    })
  })
})
