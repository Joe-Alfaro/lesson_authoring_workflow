import { HocuspocusProvider } from '@hocuspocus/provider'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import * as Y from 'yjs'
import { connectTestDb } from '../../tests/db'
import { signCollabToken } from '../auth/collab_token'
import { runMigrations } from '../db/migrate'
import { yjsDocuments } from '../db/schema'
import { createYjsPersistence } from './persistence'
import { startCollabServer, type RunningCollab } from './server'

const SECRET = 'collab-test-secret'
const USER = {
  id: '6f1c2a8e-1d7b-4f0a-9a43-0d2a7b2f9e11',
  email: 'reviewer01@example.com',
  name: 'Reviewer 01',
  role: 'reviewer' as const,
}

type Outcome = 'authenticated' | 'denied'

/** Connects a real provider, edits the document and resolves with how authentication ended. */
function connect(url: string, name: string, token: string | null) {
  const document = new Y.Doc()
  document.getText('body').insert(0, `written by ${name}`)
  let provider: HocuspocusProvider | undefined
  const outcome = new Promise<Outcome>((resolve) => {
    provider = new HocuspocusProvider({
      url,
      name,
      document,
      token,
      onAuthenticated: () => resolve('authenticated'),
      onAuthenticationFailed: () => resolve('denied'),
    })
  })
  return {
    outcome,
    close() {
      provider?.destroy()
    },
  }
}

describe('collab process', () => {
  const { pool, db } = connectTestDb()
  let collab: RunningCollab
  let wsUrl: string

  beforeAll(async () => {
    await runMigrations(pool)
    collab = await startCollabServer({
      databaseUrl: inject('databaseUrl'),
      port: 0,
      authSecret: SECRET,
    })
    wsUrl = collab.url.replace('http://', 'ws://')
  })
  afterAll(async () => {
    await collab.stop()
    await pool.end()
  })

  it('serves GET /health with 200 when the database is reachable', async () => {
    const response = await fetch(`${collab.url}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', database: 'up' })
  })

  it('rejects connections without a valid token and stores nothing for them', async () => {
    const attempts = [
      connect(wsUrl, 'denied-no-token', null),
      connect(wsUrl, 'denied-bad-token', 'v1.not.valid'),
      connect(wsUrl, 'denied-other-secret', signCollabToken(USER, 'another-secret')),
      connect(wsUrl, 'denied-expired', signCollabToken(USER, SECRET, { now: 0 })),
    ]
    const outcomes = await Promise.all(attempts.map((attempt) => attempt.outcome))
    expect(outcomes).toEqual(['denied', 'denied', 'denied', 'denied'])

    // A valid client on the same server proves stores have run before we look for denied rows.
    const allowed = connect(wsUrl, 'allowed-doc', signCollabToken(USER, SECRET))
    expect(await allowed.outcome).toBe('authenticated')
    await expect
      .poll(async () => createYjsPersistence(db).fetch('allowed-doc'), { timeout: 10_000 })
      .not.toBeNull()
    ;[...attempts, allowed].forEach((attempt) => attempt.close())

    const deniedRows = await db
      .select({ name: yjsDocuments.name })
      .from(yjsDocuments)
      .where(
        inArray(yjsDocuments.name, [
          'denied-no-token',
          'denied-bad-token',
          'denied-other-secret',
          'denied-expired',
        ]),
      )
    expect(deniedRows).toEqual([])
  })

  it('persists Yjs document state in Postgres', async () => {
    const persistence = createYjsPersistence(db)
    expect(await persistence.fetch('lesson:missing')).toBeNull()

    await persistence.store('lesson:abc', new Uint8Array([1, 2, 3]))
    await persistence.store('lesson:abc', new Uint8Array([4, 5]))

    expect(await persistence.fetch('lesson:abc')).toEqual(new Uint8Array([4, 5]))
  })
})
