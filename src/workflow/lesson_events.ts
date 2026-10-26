// Postgres NOTIFY channels the collab server LISTENs on (src/editor/README.md): a lesson's status
// changed (the edit lock may apply), or its content was replaced outside the editor.
import { eq, sql } from 'drizzle-orm'
import { yjsDocuments } from '../db/schema'
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
