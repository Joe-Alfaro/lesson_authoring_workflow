// B1 (M4 re-validation): pg-boss pools are bounded too: PGBOSS_POOL_MAX, default 2, in the web app
// and the worker.
import { describe, expect, it } from 'vitest'
import { getPgBossPoolMax, pgBossOptions } from './env'

describe('pg-boss pool size', () => {
  it('defaults to 2 and reads PGBOSS_POOL_MAX', () => {
    expect(getPgBossPoolMax({})).toBe(2)
    expect(getPgBossPoolMax({ PGBOSS_POOL_MAX: '5' })).toBe(5)
  })
  it.each(['0', '1.5', 'x'])('rejects %s', (raw) => {
    expect(() => getPgBossPoolMax({ PGBOSS_POOL_MAX: raw })).toThrow(/PGBOSS_POOL_MAX/)
  })
  it('builds the pg-boss options with the bounded pool', () => {
    expect(pgBossOptions('postgres://x', { PGBOSS_POOL_MAX: '3' })).toEqual({
      connectionString: 'postgres://x',
      max: 3,
    })
  })
})
