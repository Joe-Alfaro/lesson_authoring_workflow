import type pg from 'pg'

export interface HealthReport {
  status: 'ok' | 'unavailable'
  database: 'up' | 'down'
}

/** Health check shared by every process: 200 only when the database answers. */
export async function checkHealth(pool: pg.Pool, timeoutMs = 2_000): Promise<HealthReport> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('database health check timed out')), timeoutMs).unref()
  })
  try {
    await Promise.race([pool.query('select 1'), timeout])
    return { status: 'ok', database: 'up' }
  } catch {
    return { status: 'unavailable', database: 'down' }
  }
}

export function healthStatusCode(report: HealthReport): number {
  return report.status === 'ok' ? 200 : 503
}
