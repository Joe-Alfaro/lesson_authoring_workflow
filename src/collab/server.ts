// The collab process (R18): Hocuspocus serving one Yjs document per lesson (`lesson:<id>`), seeded
// from lessons.content, stored in yjs_documents, snapshotted back into lessons.content, versioned
// after idle editing, and locked for Approved/Generating lessons (R23, D-032 (1)).
// Contract: src/editor/README.md.
import { isDeepStrictEqual } from 'node:util'
import { Server, type Document } from '@hocuspocus/server'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { createDb, createPool } from '../db/client'
import { lessons } from '../db/schema'
import { lessonDocumentName, lessonIdOf } from '../editor/document_name'
import { LESSON_FRAGMENT, writeLesson, yDocToLesson } from '../editor/ydoc'
import { handleHealthRequest } from '../health/server'
import { isUuid } from '../import/is_uuid'
import { LessonContent } from '../lesson/schema'
import { LessonLockedError, LessonNotFoundError } from '../workflow/errors'
import { LESSON_CONTENT_CHANNEL, LESSON_STATUS_CHANNEL } from '../workflow/lesson_events'
import { isEditableStatus } from '../workflow/transitions'
import { saveEditorSnapshot, saveIdleVersion } from '../workflow/versions'
import { authenticateConnection, type CollabContext } from './authenticate'
import { compactLessonDoc, isBloated } from './compact'
import { createIdleVersioner, VERSION_IDLE_MS } from './idle_versions'
import { listenForLessonEvents } from './lesson_listener'
import { createYjsPersistence } from './persistence'

export interface CollabOptions {
  databaseUrl: string
  port: number
  /** AUTH_SECRET shared with the web app, which signs the collab tokens. */
  authSecret: string
  /** Idle time before a version is saved (D-024 (4)). */
  versionIdleMs?: number
  /** Debounce of stores (Yjs state and lesson snapshot); they wait at most MAX_STORE_WAIT_MS. */
  storeDebounceMs?: number
}

export interface RunningCollab {
  url: string
  stop(): Promise<void>
}

export type FlushAnswer =
  { type: 'flushed'; ok: true } | { type: 'flushed'; ok: false; reason: 'invalid' | 'locked' }

const STORE_DEBOUNCE_MS = 500
const MAX_STORE_WAIT_MS = 5_000

/** Changes made by the server itself (seed, restore): no editor, so no idle version. */
const SERVER_ORIGIN = { source: 'local' as const }

export async function startCollabServer(options: CollabOptions): Promise<RunningCollab> {
  const pool = createPool(options.databaseUrl)
  const db = createDb(pool)
  const persistence = createYjsPersistence(db)
  /** Who made the last change to each loaded document (becomes lessons.last_edited_by). */
  const lastEditor = new Map<string, string>()

  const versioner = createIdleVersioner({
    idleMs: options.versionIdleMs ?? VERSION_IDLE_MS,
    async onIdle(documentName, userId) {
      const lessonId = lessonIdOf(documentName)
      if (!lessonId) return
      try {
        await saveIdleVersion(db, { lessonId, userId })
      } catch (error) {
        // The lesson can be gone by then (unit deleted); there is nothing to version.
        if (!(error instanceof LessonNotFoundError)) throw error
      }
    },
  })

  async function lessonRow(lessonId: string) {
    if (!isUuid(lessonId)) return null
    const [row] = await db
      .select({ status: lessons.status, content: lessons.content })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
    return row ?? null
  }

  /** Replaces the document's lesson with `lessons.content` in one Yjs transaction. */
  function replaceContent(document: Document, content: LessonContent): void {
    const fragment = document.getXmlFragment(LESSON_FRAGMENT)
    document.transact(() => {
      fragment.delete(0, fragment.length)
      writeLesson(fragment, content)
    }, SERVER_ORIGIN)
  }

  /** Stores the Yjs state and, when it validates, the lesson snapshot (no version). */
  async function storeLesson(documentName: string, document: Document): Promise<FlushAnswer> {
    const lessonId = lessonIdOf(documentName)
    const row = lessonId ? await lessonRow(lessonId) : null
    if (!lessonId || !row || !isEditableStatus(row.status)) {
      return { type: 'flushed', ok: false, reason: 'locked' }
    }
    compactLessonDoc(document)
    const snapshot = yDocToLesson(document)
    try {
      // The Yjs row is the fence against a restore that committed before we heard of it: then
      // nothing is written, and the content-replaced handler brings the doc up to date.
      const result = await saveEditorSnapshot(db, {
        lessonId,
        userId: lastEditor.get(documentName) ?? null,
        content: snapshot.ok ? snapshot.lesson : null,
        yjs: { name: documentName, state: Y.encodeStateAsUpdate(document) },
      })
      if (result.replaced) return { type: 'flushed', ok: true }
    } catch (error) {
      // Locked, or the lesson is gone (unit deleted): nothing to store.
      if (error instanceof LessonLockedError || error instanceof LessonNotFoundError)
        return { type: 'flushed', ok: false, reason: 'locked' }
      throw error
    }
    if (!snapshot.ok) {
      // The last valid lessons.content stays; the stored Yjs state keeps the reviewer's work.
      return { type: 'flushed', ok: false, reason: 'invalid' }
    }
    return { type: 'flushed', ok: true }
  }

  const server = new Server<CollabContext>({
    port: options.port,
    quiet: true,
    stopOnSignals: false,
    debounce: options.storeDebounceMs ?? STORE_DEBOUNCE_MS,
    maxDebounce: MAX_STORE_WAIT_MS,
    async onAuthenticate({ token, documentName, connectionConfig }) {
      // R27, D-021: a valid token; then only existing lessons with content (nothing else loads).
      const context = authenticateConnection(token, options.authSecret)
      const lessonId = lessonIdOf(documentName)
      const row = lessonId ? await lessonRow(lessonId) : null
      if (!row || row.content == null) {
        throw new Error('Unknown lesson document')
      }
      // R23, D-032 (1): approved and generating lessons open read-only.
      connectionConfig.readOnly = !isEditableStatus(row.status)
      return context
    },
    async onLoadDocument({ documentName, document }) {
      const stored = await persistence.fetch(documentName)
      const row = await lessonRow(lessonIdOf(documentName) ?? '')
      if (stored) {
        const loaded = new Y.Doc()
        Y.applyUpdate(loaded, stored)
        const compacted = compactLessonDoc(loaded)
        const snapshot = yDocToLesson(loaded)
        const lesson = snapshot.ok ? snapshot.lesson : row?.content
        if (!isBloated(loaded, lesson)) {
          Y.applyUpdate(document, Y.encodeStateAsUpdate(loaded))
          if (compacted) await persistence.store(documentName, Y.encodeStateAsUpdate(document))
          return document
        }
        // Thousands of tombstones from y-tiptap 3.0.10: rebuild once from the lesson (new item ids).
        console.warn(`[collab] rebuilding bloated ${documentName} (${stored.byteLength} bytes)`)
        writeLesson(
          document.getXmlFragment(LESSON_FRAGMENT),
          snapshot.ok ? snapshot.lesson : LessonContent.parse(row?.content),
        )
        await persistence.store(documentName, Y.encodeStateAsUpdate(document))
        return document
      }
      const content = LessonContent.parse(row?.content)
      writeLesson(document.getXmlFragment(LESSON_FRAGMENT), content)
      // Stored at once, so a reconnecting client never merges into a second, different seed.
      await persistence.store(documentName, Y.encodeStateAsUpdate(document))
      return document
    },
    async onChange({ documentName, context, connection }) {
      const userId = connection ? context?.user?.id : undefined
      if (userId) {
        lastEditor.set(documentName, userId)
        versioner.touch(documentName, userId)
      }
    },
    async onStoreDocument({ documentName, document }) {
      await storeLesson(documentName, document)
    },
    async onStateless({ connection, documentName, document, payload }) {
      const message = parseMessage(payload)
      if (message?.type !== 'flush') return
      // Before submit, approve and restore: the route's own snapshot then has the latest edits.
      connection.sendStateless(JSON.stringify(await storeLesson(documentName, document)))
    },
    async afterUnloadDocument({ documentName }) {
      lastEditor.delete(documentName)
    },
    async onRequest({ request, response }) {
      if (await handleHealthRequest(pool, request, response)) {
        // Hocuspocus stops its default response when the hook rejects with a falsy value.
        return Promise.reject(null)
      }
    },
  })

  function loaded(lessonId: string): { name: string; document: Document | undefined } {
    const name = lessonDocumentName(lessonId)
    return { name, document: server.hocuspocus.documents.get(name) }
  }

  const listener = await listenForLessonEvents(pool, {
    async [LESSON_STATUS_CHANNEL](lessonId) {
      const { name, document } = loaded(lessonId)
      const row = await lessonRow(lessonId)
      if (!row) return
      const locked = !isEditableStatus(row.status)
      if (!locked) {
        document?.getConnections().forEach((connection) => (connection.readOnly = false))
        return
      }
      versioner.cancel(name)
      if (!document) return
      document.getConnections().forEach((connection) => (connection.readOnly = true))
      // An edit that raced the lock is dropped: everyone sees the approved content.
      const current = yDocToLesson(document)
      const approved = LessonContent.safeParse(row.content)
      if (approved.success && (!current.ok || !isDeepStrictEqual(current.lesson, approved.data))) {
        replaceContent(document, approved.data)
      }
    },
    async [LESSON_CONTENT_CHANNEL](lessonId) {
      const { name, document } = loaded(lessonId)
      versioner.cancel(name)
      if (!document) return
      const row = await lessonRow(lessonId)
      const content = LessonContent.safeParse(row?.content)
      if (!content.success) return
      replaceContent(document, content.data)
      // Re-open the fence (the replace deleted the Yjs row), so later stores are written.
      await persistence.store(name, Y.encodeStateAsUpdate(document))
    },
  })

  await server.listen()

  return {
    url: `http://localhost:${server.address.port}`,
    async stop() {
      versioner.stop()
      await listener.stop()
      await server.destroy()
      await pool.end()
    },
  }
}

function parseMessage(payload: string): { type?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(payload)
    return parsed !== null && typeof parsed === 'object' ? (parsed as { type?: unknown }) : null
  } catch {
    return null
  }
}
