import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDatabaseUrl, getPort, getSeedPassword, LOCAL_SEED_PASSWORD } from './env'

describe('env helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses DATABASE_URL when set', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@db:5432/app')
    expect(getDatabaseUrl()).toBe('postgres://u:p@db:5432/app')
  })

  it('falls back to the compose database locally, honoring POSTGRES_PORT', () => {
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('POSTGRES_PORT', '55432')
    expect(getDatabaseUrl()).toBe('postgres://postgres:postgres@localhost:55432/lesson_authoring')
  })

  it('requires DATABASE_URL and SEED_PASSWORD in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('SEED_PASSWORD', '')
    expect(() => getDatabaseUrl()).toThrow(/DATABASE_URL/)
    expect(() => getSeedPassword()).toThrow(/SEED_PASSWORD/)
  })

  it('uses the documented seed password locally', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SEED_PASSWORD', '')
    expect(getSeedPassword()).toBe(LOCAL_SEED_PASSWORD)
  })

  it('reads PORT, falling back to the process default', () => {
    vi.stubEnv('PORT', '')
    expect(getPort(4100)).toBe(4100)
    vi.stubEnv('PORT', '8080')
    expect(getPort(4100)).toBe(8080)
    vi.stubEnv('PORT', 'abc')
    expect(() => getPort(4100)).toThrow(/PORT/)
  })
})
