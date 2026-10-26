// Shared pieces of the load scripts (R28, R29): settings from env, a signed-in HTTP session with
// a cookie jar, timing and percentiles, and the machine the numbers were measured on.
import { cpus, totalmem } from 'node:os'

export function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim()
  if (value) return value
  if (fallback !== undefined) return fallback
  throw new Error(`${name} is required`)
}

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number >= 0`)
  return value
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A uniform random integer in [min, max]. */
export function between(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** Nearest-rank percentile (p in 0..100) of the samples; NaN when there are none. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.NaN
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]!
}

export interface Summary {
  count: number
  p50: number
  p95: number
  max: number
}

export function summarize(samples: readonly number[]): Summary {
  return {
    count: samples.length,
    p50: Math.round(percentile(samples, 50)),
    p95: Math.round(percentile(samples, 95)),
    max: Math.round(samples.length ? Math.max(...samples) : Number.NaN),
  }
}

export function machine(): string {
  const cpu = cpus()
  return `${cpu[0]?.model ?? 'unknown CPU'}, ${cpu.length} cores, ${Math.round(totalmem() / 2 ** 30)} GB RAM, Node ${process.version}, ${process.platform}`
}

export class HttpError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`${path} answered ${status}`)
    this.name = 'HttpError'
  }
}

/** One signed-in user of the web app: Auth.js's csrf and session cookies, like a browser. */
export class WebSession {
  private cookies = new Map<string, string>()

  constructor(readonly baseUrl: string) {}

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    }
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers,
      redirect: 'manual',
    })
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ''] = cookie.split(';')
      const index = pair.indexOf('=')
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    return response
  }

  /** GETs a page or API route and reads the whole body; throws HttpError unless 200 (or 304). */
  async get(path: string, headers?: Record<string, string>): Promise<Response> {
    const response = await this.fetch(path, { headers })
    await response.arrayBuffer()
    if (response.status !== 200 && response.status !== 304) {
      throw new HttpError(path, response.status)
    }
    return response
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(path, init)
    if (response.status < 200 || response.status >= 300) {
      await response.arrayBuffer()
      throw new HttpError(path, response.status)
    }
    return (await response.json()) as T
  }

  async signIn(email: string, password: string): Promise<void> {
    const { csrfToken } = await this.json<{ csrfToken: string }>('/api/auth/csrf')
    const response = await this.fetch('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email,
        password,
        csrfToken,
        callbackUrl: `${this.baseUrl}/units`,
      }),
    })
    await response.arrayBuffer()
    const session = await this.json<{ user?: { email?: string } } | null>('/api/auth/session')
    if (session?.user?.email !== email) throw new Error(`sign-in failed for ${email}`)
  }

  async collabToken(): Promise<string> {
    const { token } = await this.json<{ token: string }>('/api/collab-token')
    return token
  }
}

export async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now()
  const value = await work()
  return { value, ms: performance.now() - start }
}
