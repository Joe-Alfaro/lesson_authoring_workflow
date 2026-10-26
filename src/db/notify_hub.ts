// One LISTEN connection per pool (so per process) shared by every live feed subscriber (B1 of the
// M4 validation): an open dashboard costs no pool client, however many are open. The connection
// is a separate pg.Client built from the pool's settings; it opens with the first subscriber,
// LISTENs per channel while that channel has subscribers, reconnects after a drop, and closes when
// the last subscriber leaves.
import pg from 'pg'

type Listener = (payload: string) => void

interface Hub {
  client: pg.Client | null
  channels: Map<string, Set<Listener>>
  /** Serialises connect/LISTEN/UNLISTEN/end so concurrent (un)subscribes never interleave. */
  queue: Promise<void>
  retry: ReturnType<typeof setTimeout> | undefined
}

const RETRY_MS = 1_000
const hubs = new WeakMap<pg.Pool, Hub>()

function quoteChannel(channel: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(channel)) throw new Error(`Bad channel name "${channel}"`)
  return channel
}

function hubOf(pool: pg.Pool): Hub {
  let hub = hubs.get(pool)
  if (!hub) {
    hub = { client: null, channels: new Map(), queue: Promise.resolve(), retry: undefined }
    hubs.set(pool, hub)
  }
  return hub
}

function enqueue(hub: Hub, step: () => Promise<void>): Promise<void> {
  const next = hub.queue.then(step)
  hub.queue = next.catch((error: unknown) => console.error('[notify hub]', error))
  return next
}

async function connect(pool: pg.Pool, hub: Hub): Promise<void> {
  const { max: _max, ...settings } = pool.options as pg.PoolConfig
  void _max
  const client = new pg.Client(settings)
  client.on('notification', (message) => {
    if (!message.payload) return
    hub.channels.get(message.channel)?.forEach((listener) => {
      try {
        listener(message.payload!)
      } catch (error) {
        console.error('[notify hub] listener failed', error)
      }
    })
  })
  client.on('error', (error) => {
    console.error('[notify hub] LISTEN connection lost:', error.message)
    if (hub.client !== client) return
    hub.client = null
    client.end().catch(() => undefined)
    scheduleReconnect(pool, hub)
  })
  await client.connect()
  await Promise.all([...hub.channels.keys()].map((channel) => client.query(`LISTEN ${channel}`)))
  hub.client = client
}

function scheduleReconnect(pool: pg.Pool, hub: Hub) {
  clearTimeout(hub.retry)
  hub.retry = setTimeout(() => {
    void enqueue(hub, async () => {
      if (hub.client || hub.channels.size === 0) return
      await connect(pool, hub).catch((error: unknown) => {
        console.error('[notify hub] could not reconnect', error)
        scheduleReconnect(pool, hub)
      })
    })
  }, RETRY_MS)
}

/** Calls `listener` with each NOTIFY payload on `channel` until the returned function is called. */
export async function subscribeToChannel(
  pool: pg.Pool,
  channel: string,
  listener: Listener,
): Promise<() => Promise<void>> {
  const name = quoteChannel(channel)
  const hub = hubOf(pool)
  await enqueue(hub, async () => {
    const listeners = hub.channels.get(name) ?? new Set<Listener>()
    const isNewChannel = listeners.size === 0
    listeners.add(listener)
    hub.channels.set(name, listeners)
    if (!hub.client) {
      await connect(pool, hub)
    } else if (isNewChannel) {
      await hub.client.query(`LISTEN ${name}`)
    }
  })

  let active = true
  return () => {
    if (!active) return Promise.resolve()
    active = false
    return enqueue(hub, async () => {
      const listeners = hub.channels.get(name)
      listeners?.delete(listener)
      if (listeners && listeners.size === 0) {
        hub.channels.delete(name)
        await hub.client?.query(`UNLISTEN ${name}`).catch(() => undefined)
      }
      if (hub.channels.size === 0 && hub.client) {
        const client = hub.client
        hub.client = null
        clearTimeout(hub.retry)
        await client.end().catch(() => undefined)
      }
    })
  }
}
