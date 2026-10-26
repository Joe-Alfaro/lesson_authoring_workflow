/**
 * R28 load test: simulated reviewers against a running production build (web, collab, Postgres).
 *
 * Each reviewer signs in, opens the unit dashboard, opens their own lesson in the editor through a
 * real HocuspocusProvider (collab token from the web app) and types at a human rate, polling the
 * lesson status every 2 s like the editor. Every LOAD_SESSION_S seconds they go back to the
 * dashboard and reopen the lesson, so each reviewer contributes several open timings. Pairs open
 * the same lesson and type in the same paragraph. At the end, every marker typed must be in the
 * stored Yjs state and in lessons.content (lost_edits.ts). Method and results: docs/performance.md.
 *
 * Env: DATABASE_URL (required), LOAD_BASE_URL (http://localhost:3761), LOAD_COLLAB_URL
 * (ws://localhost:3762), LOAD_PASSWORD (demo-password), LOAD_REVIEWERS (25), LOAD_PAIRS (2),
 * LOAD_DURATION_S (300; LOAD_SHORT=1 makes it 60), LOAD_SESSION_S (60), LOAD_RESULTS_FILE.
 * Exits 1 on any error, lost edit, or a p95 open time of 1 s or more.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { createPool } from '../../src/db/client'
import { lessonDocumentName } from '../../src/editor/document_name'
import { findLostEdits, type StoredLesson, type TypedMarkers } from './lost_edits'
import {
  ensureLoadAccounts,
  importSampleUnit,
  prepareDraftLessons,
  type LoadAccount,
} from './setup'
import { between, env, envNumber, machine, sleep, summarize, timed, WebSession } from './support'
import { findTypingTarget, Typist } from './typist'

const baseUrl = env('LOAD_BASE_URL', 'http://localhost:3761')
const collabUrl = env('LOAD_COLLAB_URL', 'ws://localhost:3762')
const databaseUrl = env('DATABASE_URL')
const password = env('LOAD_PASSWORD', 'demo-password')
const reviewerCount = envNumber('LOAD_REVIEWERS', 25)
const pairCount = envNumber('LOAD_PAIRS', 2)
const durationS = envNumber('LOAD_DURATION_S', process.env.LOAD_SHORT === '1' ? 60 : 300)
const sessionS = envNumber('LOAD_SESSION_S', 60)
const resultsFile = env('LOAD_RESULTS_FILE', `test-results/load/reviewers-${Date.now()}.json`)

/** A typing burst: one marker at 120-300 ms per key, then 2-8 s of reading before the next. */
const KEY_MS = [120, 300] as const
const PAUSE_MS = [2_000, 8_000] as const
/** Share of keystrokes that are a typo fixed with backspace. */
const TYPO_RATE = 0.03
const SYNC_TIMEOUT_MS = 10_000
const SAVE_TIMEOUT_MS = 10_000
const STATUS_POLL_MS = 2_000

interface ErrorRecord {
  client: string
  kind: string
  message: string
  at: number
}

const startedAt = Date.now()
const errors: ErrorRecord[] = []
const timings = {
  signIn: [] as number[],
  dashboard: [] as number[],
  dashboardHtml: [] as number[],
  dashboardApi: [] as number[],
  lessonOpen: [] as number[],
  lessonHtml: [] as number[],
  collabToken: [] as number[],
  firstSync: [] as number[],
  statusPoll: [] as number[],
  coEditSeen: [] as number[],
}
let keystrokes = 0
let reconnects = 0

function recordError(client: string, kind: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  errors.push({ client, kind, message, at: Math.round((Date.now() - startedAt) / 1000) })
  console.error(`[load] ${client} ${kind}: ${message}`)
}

/** Markers completed by a pair member, waiting to be seen by the partner: marker -> typed at. */
const pending = new Map<string, Map<string, number>>()

interface Client {
  name: string
  account: LoadAccount
  lessonId: string
  /** Pair key for co-editors (both share the lesson). */
  pair?: string
  typed: string[]
}

interface OpenLesson {
  provider: HocuspocusProvider
  doc: Y.Doc
  close(): Promise<void>
}

function openProvider(client: Client, session: WebSession, token: string): Promise<OpenLesson> {
  const doc = new Y.Doc()
  let first = true
  let closing = false
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      provider.destroy()
      reject(new Error('first sync took over 10 s'))
    }, SYNC_TIMEOUT_MS)
    const provider: HocuspocusProvider = new HocuspocusProvider({
      url: collabUrl,
      name: lessonDocumentName(client.lessonId),
      document: doc,
      // The editor fetches a fresh token per (re)connect (D-021); the first one is pre-fetched.
      token: async () => {
        if (first) {
          first = false
          return token
        }
        reconnects += 1
        return session.collabToken()
      },
      onSynced: () => {
        clearTimeout(timer)
        resolve({
          provider,
          doc,
          close: async () => {
            const saved = await waitFor(() => !provider.hasUnsyncedChanges, SAVE_TIMEOUT_MS)
            if (!saved) recordError(client.name, 'unsaved', 'edits not acknowledged in 10 s')
            closing = true
            provider.destroy()
            doc.destroy()
          },
        })
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timer)
        reject(new Error(`collab authentication failed: ${reason}`))
      },
      onClose: ({ event }) => {
        if (!closing) {
          recordError(client.name, 'disconnect', `collab socket closed (${event.code})`)
        }
      },
    })
    provider.setAwarenessField('user', { id: client.account.id, name: client.account.name })
  })
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) return false
    await sleep(50)
  }
  return true
}

function flush(provider: HocuspocusProvider): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      provider.off('stateless', onStateless)
      resolve({ ok: false, reason: 'timeout' })
    }, 5_000)
    function onStateless({ payload }: { payload: string }) {
      const message = JSON.parse(payload) as { type?: string; ok?: boolean; reason?: string }
      if (message.type !== 'flushed') return
      clearTimeout(timer)
      provider.off('stateless', onStateless)
      resolve({ ok: Boolean(message.ok), reason: message.reason })
    }
    provider.on('stateless', onStateless)
    provider.sendStateless(JSON.stringify({ type: 'flush' }))
  })
}

/** The editor's live status: GET /api/lessons/:id/status every 2 s with the last ETag. */
function pollStatus(client: Client, session: WebSession, stop: AbortSignal): Promise<void> {
  return (async () => {
    let etag: string | null = null
    while (!stop.aborted) {
      await sleep(STATUS_POLL_MS)
      if (stop.aborted) return
      try {
        const { value, ms } = await timed(() =>
          session.get(
            `/api/lessons/${client.lessonId}/status`,
            etag ? { 'If-None-Match': etag } : undefined,
          ),
        )
        timings.statusPoll.push(ms)
        etag = value.headers.get('ETag') ?? etag
      } catch (error) {
        recordError(client.name, 'status', error)
      }
    }
  })()
}

async function openDashboard(session: WebSession, unitId: string): Promise<void> {
  const html = await timed(() => session.get(`/units/${unitId}`))
  const api = await timed(() => session.get(`/api/units/${unitId}/dashboard`))
  timings.dashboardHtml.push(html.ms)
  timings.dashboardApi.push(api.ms)
  timings.dashboard.push(html.ms + api.ms)
}

/** Lesson open: the editor page's HTML, its collab token, then the first Yjs sync. */
async function openLesson(client: Client, session: WebSession): Promise<OpenLesson> {
  const html = await timed(() => session.get(`/lessons/${client.lessonId}`))
  const token = await timed(() => session.collabToken())
  const sync = await timed(() => openProvider(client, session, token.value))
  timings.lessonHtml.push(html.ms)
  timings.collabToken.push(token.ms)
  timings.firstSync.push(sync.ms)
  timings.lessonOpen.push(html.ms + token.ms + sync.ms)
  return sync.value
}

/** Types markers until the deadline; returns the markers typed in full. */
async function edit(client: Client, lesson: OpenLesson, until: number): Promise<void> {
  const typist = new Typist(lesson.doc, findTypingTarget(lesson.doc))
  const partnerKey = client.pair ? `${client.pair}:${client.name}` : null
  // Co-editing latency: how long after the partner finished a marker it shows up here. Markers
  // already in the document when this editor opens arrived while it was closed: not counted.
  const watchPartner = (record: boolean) => {
    if (!client.pair) return
    const text = findTypingTarget(lesson.doc).toString()
    pending.forEach((markers, key) => {
      if (!key.startsWith(`${client.pair}:`) || key === partnerKey) return
      markers.forEach((typedAt, marker) => {
        if (text.includes(marker)) {
          if (record) timings.coEditSeen.push(Date.now() - typedAt)
          markers.delete(marker)
        }
      })
    })
  }
  watchPartner(false)
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === lesson.provider) watchPartner(true)
  }
  lesson.doc.on('update', onUpdate)
  try {
    while (Date.now() < until) {
      const marker = ` [${client.name}-${String(client.typed.length + 1).padStart(3, '0')}]`
      for (const [index, char] of [...marker].entries()) {
        if (Math.random() < TYPO_RATE) {
          typist.type('x')
          await sleep(between(...KEY_MS))
          typist.backspace()
          keystrokes += 2
          await sleep(between(...KEY_MS))
        }
        typist.type(char)
        keystrokes += 1
        if (index === marker.length - 1) {
          // Complete now: register it before the partner's copy of this keystroke can arrive.
          client.typed.push(marker)
          if (partnerKey) {
            const mine = pending.get(partnerKey) ?? new Map<string, number>()
            mine.set(marker, Date.now())
            pending.set(partnerKey, mine)
          }
        }
        lesson.provider.setAwarenessField('cursor', {
          anchor: typist.cursorJson(),
          head: typist.cursorJson(),
        })
        await sleep(between(...KEY_MS))
      }
      await sleep(Math.min(between(...PAUSE_MS), Math.max(0, until - Date.now())))
    }
  } finally {
    lesson.doc.off('update', onUpdate)
  }
}

async function runClient(client: Client, unitId: string, deadline: number): Promise<void> {
  const session = new WebSession(baseUrl)
  try {
    const signIn = await timed(() => session.signIn(client.account.email, password))
    timings.signIn.push(signIn.ms)
  } catch (error) {
    recordError(client.name, 'sign-in', error)
    return
  }
  // Stagger the cycles so reopenings don't all land at once.
  await sleep(between(0, 3_000))
  while (Date.now() < deadline) {
    try {
      await openDashboard(session, unitId)
    } catch (error) {
      recordError(client.name, 'dashboard', error)
    }
    let lesson: OpenLesson
    try {
      lesson = await openLesson(client, session)
    } catch (error) {
      recordError(client.name, 'lesson-open', error)
      await sleep(2_000)
      continue
    }
    const stopPolling = new AbortController()
    const polling = pollStatus(client, session, stopPolling.signal)
    try {
      const until = Math.min(deadline, Date.now() + between(sessionS * 800, sessionS * 1200))
      await edit(client, lesson, until)
      if (Date.now() >= deadline) {
        // The last close of the run: what the editor does before submit (flush, then leave).
        await waitFor(() => !lesson.provider.hasUnsyncedChanges, SAVE_TIMEOUT_MS)
        const flushed = await flush(lesson.provider)
        if (!flushed.ok) recordError(client.name, 'flush', `flush answered ${flushed.reason}`)
      }
    } catch (error) {
      recordError(client.name, 'edit', error)
    } finally {
      stopPolling.abort()
      await polling
      await lesson.close()
    }
  }
}

async function storedLessons(lessonIds: string[]): Promise<StoredLesson[]> {
  const pool = createPool(databaseUrl)
  try {
    const result = await pool.query<{ id: string; content: unknown; state: Buffer | null }>(
      `SELECT l.id, l.content, y.state FROM lessons l
       LEFT JOIN yjs_documents y ON y.name = 'lesson:' || l.id
       WHERE l.id = ANY($1::uuid[])`,
      [lessonIds],
    )
    return result.rows.map((row) => ({
      lessonId: row.id,
      content: row.content,
      yjsState: row.state ? new Uint8Array(row.state) : null,
    }))
  } finally {
    await pool.end()
  }
}

async function main(): Promise<void> {
  const soloCount = reviewerCount
  const totalClients = soloCount + pairCount * 2
  const lessonsNeeded = soloCount + pairCount
  console.log(
    `[load] ${soloCount} reviewers on separate lessons + ${pairCount} co-editing pairs ` +
      `(${totalClients} clients, ${lessonsNeeded} lessons) for ${durationS} s against ${baseUrl}`,
  )

  const pool = createPool(databaseUrl)
  let unitId: string
  const clients: Client[] = []
  try {
    const accounts = await ensureLoadAccounts(pool, totalClients, password)
    const unit = await importSampleUnit(pool)
    unitId = unit.unitId
    if (unit.lessons.length < lessonsNeeded) {
      throw new Error(`the sample unit has ${unit.lessons.length} lessons; ${lessonsNeeded} needed`)
    }
    for (let i = 0; i < soloCount; i += 1) {
      clients.push({
        name: `r${String(i + 1).padStart(2, '0')}`,
        account: accounts[i]!,
        lessonId: unit.lessons[i]!.id,
        typed: [],
      })
    }
    for (let p = 0; p < pairCount; p += 1) {
      const lesson = unit.lessons[soloCount + p]!
      for (const side of ['a', 'b']) {
        clients.push({
          name: `p${p + 1}${side}`,
          account: accounts[soloCount + p * 2 + (side === 'a' ? 0 : 1)]!,
          lessonId: lesson.id,
          pair: `p${p + 1}`,
          typed: [],
        })
      }
    }
    await prepareDraftLessons(
      pool,
      unit.lessons.slice(0, lessonsNeeded).map((lesson) => ({
        ...lesson,
        assigneeId: clients.find((client) => client.lessonId === lesson.id)!.account.id,
      })),
    )
  } finally {
    await pool.end()
  }
  console.log(`[load] unit ${unitId} ready; starting clients`)

  const loopLag = monitorEventLoopDelay({ resolution: 20 })
  loopLag.enable()
  const runStart = Date.now()
  const deadline = runStart + durationS * 1000
  const progress = setInterval(() => {
    const elapsed = Math.round((Date.now() - runStart) / 1000)
    console.log(
      `[load] ${elapsed}s: ${keystrokes} keys, ${timings.lessonOpen.length} opens, ` +
        `${errors.length} errors`,
    )
  }, 30_000)
  await Promise.all(clients.map((client) => runClient(client, unitId, deadline)))
  clearInterval(progress)
  loopLag.disable()
  const elapsedS = Math.round((Date.now() - runStart) / 1000)

  // Stores are debounced (max wait 5 s): give the last ones time to land before reading.
  await sleep(6_000)
  const typed: TypedMarkers[] = clients.map((client) => ({
    lessonId: client.lessonId,
    markers: client.typed,
  }))
  const lessonIds = [...new Set(clients.map((client) => client.lessonId))]
  const lost = findLostEdits(typed, await storedLessons(lessonIds))
  // Markers a partner finished after the other side left for good are never "seen": not an error.
  const unseen = [...pending.values()].reduce((sum, markers) => sum + markers.size, 0)

  const results = {
    requirement: 'R28',
    machine: machine(),
    startedAt: new Date(runStart).toISOString(),
    config: {
      baseUrl,
      collabUrl,
      reviewers: soloCount,
      pairs: pairCount,
      clients: totalClients,
      durationS,
      sessionS,
      keyMs: KEY_MS,
      pauseMs: PAUSE_MS,
      typoRate: TYPO_RATE,
    },
    elapsedS,
    keystrokes,
    markersTyped: clients.reduce((sum, client) => sum + client.typed.length, 0),
    reconnects,
    lostEdits: lost,
    coEditMarkersNeverSeen: unseen,
    errors,
    timingsMs: Object.fromEntries(
      Object.entries(timings).map(([name, samples]) => [name, summarize(samples)]),
    ),
    loadGeneratorEventLoopLagMs: {
      p50: Math.round(loopLag.percentile(50) / 1e6),
      p99: Math.round(loopLag.percentile(99) / 1e6),
      max: Math.round(loopLag.max / 1e6),
    },
  }
  mkdirSync(dirname(resultsFile), { recursive: true })
  writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`)

  console.log('\n[load] R28 results')
  console.table(results.timingsMs)
  console.log(
    `keystrokes ${keystrokes}, markers ${results.markersTyped}, errors ${errors.length}, ` +
      `lost edits ${lost.length}, co-edit markers unseen at the end ${unseen}, reconnects ${reconnects}`,
  )
  console.log(
    `event loop lag of this script: ${JSON.stringify(results.loadGeneratorEventLoopLagMs)}`,
  )
  console.log(`[load] written to ${resultsFile}`)

  const dashboard = summarize(timings.dashboard)
  const lessonOpen = summarize(timings.lessonOpen)
  // NaN (no samples) also fails: the run measured nothing.
  const slow = !(dashboard.p95 < 1000) || !(lessonOpen.p95 < 1000)
  const failed = errors.length > 0 || lost.length > 0 || slow
  console.log(failed ? '[load] FAIL' : '[load] PASS')
  process.exit(failed ? 1 : 0)
}

await main()
