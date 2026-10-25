import { describe, expect, it, vi } from 'vitest'
import { retryWithBackoff } from './retry'

describe('retryWithBackoff', () => {
  it('retries until the task succeeds, doubling the delay up to the cap', async () => {
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue('up')
    const delays: number[] = []

    const result = await retryWithBackoff(task, {
      initialDelayMs: 10,
      maxDelayMs: 25,
      onRetry: (_error, delayMs) => delays.push(delayMs),
    })

    expect(result).toBe('up')
    expect(task).toHaveBeenCalledTimes(4)
    expect(delays).toEqual([10, 20, 25])
  })

  it('stops retrying when aborted', async () => {
    const controller = new AbortController()
    const task = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('down'))

    const running = retryWithBackoff(task, {
      initialDelayMs: 5,
      maxDelayMs: 5,
      signal: controller.signal,
      onRetry: () => controller.abort(),
    })

    await expect(running).rejects.toThrow(/aborted/i)
    expect(task).toHaveBeenCalledTimes(1)
  })
})
