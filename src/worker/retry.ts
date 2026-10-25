import { setTimeout as sleep } from 'node:timers/promises'

export interface RetryOptions {
  initialDelayMs: number
  maxDelayMs: number
  signal?: AbortSignal
  onRetry?: (error: unknown, delayMs: number) => void
}

/** Runs `task` until it resolves, waiting with exponential backoff between failures. */
export async function retryWithBackoff<T>(
  task: () => Promise<T>,
  { initialDelayMs, maxDelayMs, signal, onRetry }: RetryOptions,
  delayMs = initialDelayMs,
): Promise<T> {
  signal?.throwIfAborted()
  try {
    return await task()
  } catch (error) {
    onRetry?.(error, delayMs)
    await sleep(delayMs, undefined, { signal })
    return retryWithBackoff(
      task,
      { initialDelayMs, maxDelayMs, signal, onRetry },
      Math.min(delayMs * 2, maxDelayMs),
    )
  }
}
