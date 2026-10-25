// R14, D-024 (4): a version is saved after 30 s of idle editing. The timer logic is a unit with an
// injectable delay so it can run under fake timers. Contract: src/editor/README.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdleVersioner, VERSION_IDLE_MS } from './idle_versions'

describe('createIdleVersioner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to 30 seconds of idle editing', () => {
    expect(VERSION_IDLE_MS).toBe(30_000)
  })

  it('saves once, 30 s after the last edit, not after each edit', async () => {
    const onIdle = vi.fn()
    const versioner = createIdleVersioner({ onIdle })
    versioner.touch('lesson:a', 'user-1')
    await vi.advanceTimersByTimeAsync(20_000)
    versioner.touch('lesson:a', 'user-2')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(onIdle).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
    // The version's author is whoever edited last.
    expect(onIdle).toHaveBeenCalledWith('lesson:a', 'user-2')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
    versioner.stop()
  })

  it('keeps one timer per document', async () => {
    const onIdle = vi.fn()
    const versioner = createIdleVersioner({ onIdle, idleMs: 1_000 })
    versioner.touch('lesson:a', 'user-1')
    await vi.advanceTimersByTimeAsync(500)
    versioner.touch('lesson:b', 'user-2')
    await vi.advanceTimersByTimeAsync(500)
    expect(onIdle.mock.calls).toEqual([['lesson:a', 'user-1']])
    await vi.advanceTimersByTimeAsync(500)
    expect(onIdle.mock.calls).toEqual([
      ['lesson:a', 'user-1'],
      ['lesson:b', 'user-2'],
    ])
    versioner.stop()
  })

  it('flush saves a pending version now and cancels its timer (before submit, approve, restore)', async () => {
    const onIdle = vi.fn()
    const versioner = createIdleVersioner({ onIdle })
    versioner.touch('lesson:a', 'user-1')
    expect(versioner.pending('lesson:a')).toBe(true)
    await versioner.flush('lesson:a')
    expect(onIdle).toHaveBeenCalledTimes(1)
    expect(versioner.pending('lesson:a')).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
    // Nothing pending: flush does nothing.
    await versioner.flush('lesson:a')
    expect(onIdle).toHaveBeenCalledTimes(1)
    versioner.stop()
  })

  it('cancel drops a pending version without saving (lesson locked or replaced)', async () => {
    const onIdle = vi.fn()
    const versioner = createIdleVersioner({ onIdle })
    versioner.touch('lesson:a', 'user-1')
    versioner.cancel('lesson:a')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onIdle).not.toHaveBeenCalled()
    versioner.stop()
  })

  it('stop clears every timer', async () => {
    const onIdle = vi.fn()
    const versioner = createIdleVersioner({ onIdle })
    versioner.touch('lesson:a', 'user-1')
    versioner.touch('lesson:b', 'user-1')
    versioner.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onIdle).not.toHaveBeenCalled()
  })
})
