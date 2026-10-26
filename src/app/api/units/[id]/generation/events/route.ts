import { eq } from 'drizzle-orm'
import { requireApiRole } from '../../../../../../auth/require_role'
import { getDb } from '../../../../../../db/client'
import { units } from '../../../../../../db/schema'
import {
  getUnitProgress,
  subscribeToUnitProgress,
  type LessonProgressEvent,
} from '../../../../../../generation/progress'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function message(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

/** Server-Sent Events feed of a unit's lesson generation status (R9). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const access = await requireApiRole(['author', 'reviewer', 'approver'])
  if (access instanceof Response) {
    return access
  }
  const { id } = await params
  const db = getDb()
  const [unit] = UUID.test(id)
    ? await db.select({ id: units.id }).from(units).where(eq(units.id, id))
    : []
  if (!unit) {
    return Response.json({ error: 'Unit not found' }, { status: 404 })
  }

  let unsubscribe: (() => Promise<void>) | null = null
  let open = true
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Events that arrive while the snapshot is being read are sent right after it.
      let pending: LessonProgressEvent[] | null = []
      function send(data: unknown) {
        if (open) {
          controller.enqueue(message(data))
        }
      }
      async function close() {
        if (!open) {
          return
        }
        open = false
        await unsubscribe?.()
        try {
          controller.close()
        } catch {
          // Already closed by the reader cancelling the stream.
        }
      }
      request.signal.addEventListener('abort', () => void close(), { once: true })

      unsubscribe = await subscribeToUnitProgress(db, unit.id, (event) => {
        if (pending) {
          pending.push(event)
          return
        }
        send(event)
      })
      if (request.signal.aborted) {
        await close()
        return
      }
      send({ type: 'snapshot', progress: await getUnitProgress(db, unit.id) })
      const queued = pending
      pending = null
      queued.forEach(send)
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
