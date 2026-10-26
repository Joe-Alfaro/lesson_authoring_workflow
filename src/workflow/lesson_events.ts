// Postgres NOTIFY channels the collab server LISTENs on (src/editor/README.md): a lesson's status
// changed (the edit lock may apply), or its content was replaced outside the editor. The web app
// LISTENs to the first too, to update open editors (subscribeToLessonStatus).
import { eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import type { Database } from '../db/client'
import { lessons, yjsDocuments, type LessonStatus } from '../db/schema'
import { lessonDocumentName } from '../editor/document_name'
import type { Transaction } from './lesson_rows'

export const LESSON_STATUS_CHANNEL = 'lesson_status_changed'
export const LESSON_CONTENT_CHANNEL = 'lesson_content_replaced'

export async function notifyStatusChanged(tx: Transaction, lessonId: string): Promise<void> {
  await tx.execute(sql`select pg_notify(${LESSON_STATUS_CHANNEL}, ${lessonId})`)
}

/**
 * The lesson's content was replaced (restore, regeneration): the stored Yjs state is dropped so the
 * next load seeds from `lessons.content`, and a loaded document is replaced (on commit).
 */
export async function notifyContentReplaced(tx: Transaction, lessonId: string): Promise<void> {
  await tx.delete(yjsDocuments).where(eq(yjsDocuments.name, lessonDocumentName(lessonId)))
  await tx.execute(sql`select pg_notify(${LESSON_CONTENT_CHANNEL}, ${lessonId})`)
}

/**
 * Calls `listener` with the lesson's new status each time it changes (R23 live lock in open
 * editors), on a dedicated LISTEN connection, until unsubscribed.
 */
export async function subscribeToLessonStatus(
  db: Database,
  lessonId: string,
  listener: (status: LessonStatus) => void,
): Promise<() => Promise<void>> {
  const client = await (db as Database & { $client: pg.Pool }).$client.connect()
  let active = true
  function onNotification(message: pg.Notification) {
    if (!active || message.channel !== LESSON_STATUS_CHANNEL || message.payload !== lessonId) {
      return
    }
    void db
      .select({ status: lessons.status })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .then(([row]) => {
        if (active && row) listener(row.status)
      })
      .catch((error: unknown) => console.error('[lesson events] status read failed', error))
  }
  function onError(error: Error) {
    console.error('[lesson events] listener connection error:', error.message)
  }
  client.on('notification', onNotification)
  client.on('error', onError)
  await client.query(`LISTEN ${LESSON_STATUS_CHANNEL}`)

  return async () => {
    if (!active) return
    active = false
    client.off('notification', onNotification)
    try {
      await client.query(`UNLISTEN ${LESSON_STATUS_CHANNEL}`)
      client.off('error', onError)
      client.release()
    } catch (error) {
      client.off('error', onError)
      client.release(error instanceof Error ? error : true)
    }
  }
}
