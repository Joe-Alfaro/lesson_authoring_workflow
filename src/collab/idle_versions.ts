// D-024 (4): a lesson version after 30 s without edits, authored by the last editor. One timer per
// document; flush runs a pending version now (before submit, approve, restore).
export const VERSION_IDLE_MS = 30_000

export interface IdleVersioner {
  /** An edit: (re)starts the document's timer and remembers the editor. */
  touch(documentName: string, userId: string): void
  /** Runs onIdle now if a version is pending, and cancels the timer. */
  flush(documentName: string): Promise<void>
  /** Drops a pending version (lesson locked or replaced). */
  cancel(documentName: string): void
  pending(documentName: string): boolean
  stop(): void
}

interface Pending {
  timer: ReturnType<typeof setTimeout>
  userId: string
}

export function createIdleVersioner(options: {
  onIdle: (documentName: string, userId: string) => void | Promise<void>
  idleMs?: number
}): IdleVersioner {
  const idleMs = options.idleMs ?? VERSION_IDLE_MS
  const pending = new Map<string, Pending>()

  async function run(documentName: string): Promise<void> {
    const entry = pending.get(documentName)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(documentName)
    await options.onIdle(documentName, entry.userId)
  }

  function cancel(documentName: string): void {
    const entry = pending.get(documentName)
    if (entry) clearTimeout(entry.timer)
    pending.delete(documentName)
  }

  return {
    touch(documentName, userId) {
      cancel(documentName)
      const timer = setTimeout(() => {
        void Promise.resolve(run(documentName)).catch((error: unknown) => {
          console.error('[collab] idle version failed', error)
        })
      }, idleMs)
      pending.set(documentName, { timer, userId })
    },
    flush: run,
    cancel,
    pending: (documentName) => pending.has(documentName),
    stop() {
      pending.forEach((entry) => clearTimeout(entry.timer))
      pending.clear()
    },
  }
}
