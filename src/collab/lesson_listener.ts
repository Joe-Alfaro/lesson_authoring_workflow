// LISTENs on the workflow's lesson channels (src/workflow/lesson_events.ts) on one dedicated
// connection, and LISTENs again after a dropped connection.
import type pg from 'pg'

export type LessonEventHandlers = Record<string, (lessonId: string) => Promise<void>>

const RETRY_MS = 1_000

export async function listenForLessonEvents(
  pool: pg.Pool,
  handlers: LessonEventHandlers,
): Promise<{ stop(): Promise<void> }> {
  const channels = Object.keys(handlers)
  let client: pg.PoolClient | null = null
  let stopped = false
  let retry: ReturnType<typeof setTimeout> | undefined

  function onNotification(message: pg.Notification) {
    const handler = handlers[message.channel]
    if (!handler || !message.payload) return
    handler(message.payload).catch((error: unknown) => {
      console.error(`[collab] ${message.channel} failed`, error)
    })
  }

  async function connect(): Promise<void> {
    const next = await pool.connect()
    next.on('notification', onNotification)
    next.on('error', (error) => {
      console.error('[collab] lesson event listener lost its connection:', error.message)
      next.release(true)
      if (client === next) client = null
      if (!stopped) retry = setTimeout(() => void connect().catch(scheduleRetry), RETRY_MS)
    })
    await Promise.all(channels.map((channel) => next.query(`LISTEN ${channel}`)))
    client = next
  }

  function scheduleRetry(error: unknown) {
    console.error('[collab] could not LISTEN for lesson events', error)
    if (!stopped) retry = setTimeout(() => void connect().catch(scheduleRetry), RETRY_MS)
  }

  await connect()

  return {
    async stop() {
      stopped = true
      clearTimeout(retry)
      const current = client
      client = null
      if (current) {
        current.removeListener('notification', onNotification)
        await current.query('UNLISTEN *').catch(() => undefined)
        current.release()
      }
    },
  }
}
