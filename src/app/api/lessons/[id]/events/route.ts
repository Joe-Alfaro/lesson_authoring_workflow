import { requireRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { subscribeToLessonStatus } from '../../../../../workflow/lesson_events'
import { assertLessonExists } from '../../../../../workflow/lesson_rows'
import { workflowErrorResponse } from '../../../../../workflow/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function message(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

/**
 * Server-Sent Events: `{ type: 'status', status }` each time the lesson's status changes, so open
 * editors update their pill, actions and lock without a reload (R23).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requireRole(['author', 'reviewer', 'approver'])
  const { id } = await params
  const db = getDb()
  try {
    await assertLessonExists(db, id)
  } catch (error) {
    return workflowErrorResponse(error)
  }

  let unsubscribe: (() => Promise<void>) | null = null
  let open = true
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      async function close() {
        if (!open) return
        open = false
        await unsubscribe?.()
        try {
          controller.close()
        } catch {
          // Already closed by the reader cancelling the stream.
        }
      }
      request.signal.addEventListener('abort', () => void close(), { once: true })
      unsubscribe = await subscribeToLessonStatus(db, id, (status) => {
        if (open) controller.enqueue(message({ type: 'status', status }))
      })
      if (request.signal.aborted) {
        await close()
        return
      }
      // A comment line so the browser sees the stream open at once.
      controller.enqueue(new TextEncoder().encode(': open\n\n'))
    },
    async cancel() {
      open = false
      await unsubscribe?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
