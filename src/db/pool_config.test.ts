// DB_POOL_MAX sizes the web app's Postgres pool (Railway, B1 of the M4 validation).
import { describe, expect, it } from 'vitest'
import { getDbPoolMax } from '../config/env'

describe('getDbPoolMax', () => {
  it('defaults to 10', () => {
    expect(getDbPoolMax({})).toBe(10)
  })
  it('reads DB_POOL_MAX', () => {
    expect(getDbPoolMax({ DB_POOL_MAX: '25' })).toBe(25)
  })
  it.each(['0', '-1', '2.5', 'many'])('rejects %s', (raw) => {
    expect(() => getDbPoolMax({ DB_POOL_MAX: raw })).toThrow(/DB_POOL_MAX/)
  })
})
