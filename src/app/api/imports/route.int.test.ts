// R1, R4, R5 at the API level: POST /api/imports (preview), POST /api/imports/:id/confirm,
// DELETE /api/imports/:id (cancel), POST /api/units/:id/eld. Contract: src/import/README.md.
import { sql } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from 'vitest'
import { STANDARDS_DIR, filledEldCsv, sampleOutlineCsv } from '../../../../tests/import_fixtures'

const { requireApiRole } = vi.hoisted(() => ({ requireApiRole: vi.fn() }))
vi.mock('../../../auth/require_role', () => ({ requireApiRole }))

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1AbC-dEf_123456789xyz/edit?usp=sharing'
const NOT_SHARED = /must be shared.*anyone with the link/i

function jsonRequest(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function fileRequest(url: string, csv: string, name: string) {
  const form = new FormData()
  form.append('file', new File([csv], name, { type: 'text/csv' }))
  return new Request(`http://localhost${url}`, { method: 'POST', body: form })
}

function params<T>(value: T) {
  return { params: Promise.resolve(value) }
}

describe('import API', () => {
  let routes: {
    preview: typeof import('./route')
    confirm: typeof import('./[id]/confirm/route')
    cancel: typeof import('./[id]/route')
    eld: typeof import('../units/[id]/eld/route')
  }
  let db: import('../../../db/client').Database
  let authorId: string

  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl')
    const client = await import('../../../db/client')
    const { runMigrations } = await import('../../../db/migrate')
    const { loadStandards } = await import('../../../db/seed/standards')
    await runMigrations(client.getPool())
    db = client.getDb()
    await loadStandards(db, STANDARDS_DIR)
    const { users } = await import('../../../db/schema')
    const [author] = await db
      .insert(users)
      .values({
        email: 'api-author@example.com',
        name: 'API Author',
        role: 'author',
        passwordHash: 'x',
      })
      .onConflictDoUpdate({ target: users.email, set: { name: 'API Author' } })
      .returning({ id: users.id })
    authorId = author!.id
    routes = {
      preview: await import('./route'),
      confirm: await import('./[id]/confirm/route'),
      cancel: await import('./[id]/route'),
      eld: await import('../units/[id]/eld/route'),
    }
  })
  afterAll(async () => {
    // Integration files share one database; leave no units, imports, standards or users behind.
    const { eq } = await import('drizzle-orm')
    const { pendingImports, standards, units, users } = await import('../../../db/schema')
    await db.delete(units)
    await db.delete(pendingImports)
    await db.delete(standards)
    await db.delete(users).where(eq(users.id, authorId))
    const { getPool } = await import('../../../db/client')
    await getPool().end()
  })
  beforeEach(async () => {
    const { units } = await import('../../../db/schema')
    await db.delete(units)
    requireApiRole.mockReset()
    requireApiRole.mockResolvedValue({
      id: authorId,
      email: 'api-author@example.com',
      role: 'author',
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function unitCount() {
    const { units } = await import('../../../db/schema')
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(units)
    return row?.count ?? 0
  }

  it('previews an uploaded CSV, then confirms it into a unit', async () => {
    const response = await routes.preview.POST(
      fileRequest('/api/imports', sampleOutlineCsv(), 'lesson_outline.csv'),
    )
    expect(response.status).toBe(200)
    const preview = await response.json()
    expect(preview.lessons).toHaveLength(41)
    expect(preview.flexDays).toHaveLength(6)
    expect(preview.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'RL.6.9.a' })]),
    )
    expect(requireApiRole).toHaveBeenCalledWith(['author'])
    expect(await unitCount()).toBe(0)

    const confirmed = await routes.confirm.POST(
      new Request(`http://localhost/api/imports/${preview.importId}/confirm`, { method: 'POST' }),
      params({ id: preview.importId }),
    )
    expect(confirmed.status).toBe(201)
    expect(await confirmed.json()).toEqual({ unitId: expect.any(String) })
    expect(await unitCount()).toBe(1)
  })

  it('previews a sheet link with the same lessons as the upload', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(sampleOutlineCsv(), { status: 200, headers: { 'content-type': 'text/csv' } }),
    )
    vi.stubGlobal('fetch', fetchStub)

    const fromLink = await (
      await routes.preview.POST(jsonRequest('/api/imports', { url: SHEET_URL }))
    ).json()
    const fromFile = await (
      await routes.preview.POST(fileRequest('/api/imports', sampleOutlineCsv(), 'outline.csv'))
    ).json()

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(fromLink.lessons).toEqual(fromFile.lessons)
  })

  it('answers 400 with the "share by link" message for a private sheet and creates no unit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<!DOCTYPE html><html><title>Sign in</title></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )

    const response = await routes.preview.POST(jsonRequest('/api/imports', { url: SHEET_URL }))

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(NOT_SHARED)
    expect(await unitCount()).toBe(0)
  })

  it('answers 400 for a link that is not a Google Sheet and for a request without input', async () => {
    const badLink = await routes.preview.POST(
      jsonRequest('/api/imports', { url: 'https://example.com/x.csv' }),
    )
    expect(badLink.status).toBe(400)
    expect((await badLink.json()).error).toEqual(expect.any(String))

    const empty = await routes.preview.POST(jsonRequest('/api/imports', {}))
    expect(empty.status).toBe(400)
  })

  it('answers 400 for an uploaded file that is not an outline', async () => {
    const response = await routes.preview.POST(
      fileRequest('/api/imports', 'Name,Age\nBob,3\n', 'other.csv'),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toEqual(expect.any(String))
  })

  it('cancels a pending import: 204, no unit, and confirm then answers 404', async () => {
    const preview = await (
      await routes.preview.POST(fileRequest('/api/imports', sampleOutlineCsv(), 'outline.csv'))
    ).json()

    const cancelled = await routes.cancel.DELETE(
      new Request(`http://localhost/api/imports/${preview.importId}`, { method: 'DELETE' }),
      params({ id: preview.importId }),
    )
    expect(cancelled.status).toBe(204)

    const confirmed = await routes.confirm.POST(
      new Request(`http://localhost/api/imports/${preview.importId}/confirm`, { method: 'POST' }),
      params({ id: preview.importId }),
    )
    expect(confirmed.status).toBe(404)
    expect(await unitCount()).toBe(0)
  })

  it('attaches an ELD file to a unit and returns matches and warnings (R5)', async () => {
    const preview = await (
      await routes.preview.POST(fileRequest('/api/imports', sampleOutlineCsv(), 'outline.csv'))
    ).json()
    const { unitId } = await (
      await routes.confirm.POST(
        new Request(`http://localhost/api/imports/${preview.importId}/confirm`, { method: 'POST' }),
        params({ id: preview.importId }),
      )
    ).json()

    const response = await routes.eld.POST(
      fileRequest(`/api/units/${unitId}/eld`, filledEldCsv(), 'eld.csv'),
      params({ id: unitId }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.matched).toBe(7)
    expect(body.warnings).toHaveLength(3)
  })

  it('checks the author role before doing anything', async () => {
    // The guard's own refusal (D-032 (4)): the route returns it as is.
    requireApiRole.mockResolvedValue(Response.json({ error: 'Not allowed' }, { status: 403 }))

    const response = await routes.preview.POST(
      fileRequest('/api/imports', sampleOutlineCsv(), 'outline.csv'),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Not allowed' })
    expect(await unitCount()).toBe(0)
  })
})
