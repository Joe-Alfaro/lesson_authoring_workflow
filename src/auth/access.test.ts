import { describe, expect, it } from 'vitest'
import { decideAccess } from './access'

describe('decideAccess', () => {
  it('redirects signed-out visitors on pages', () => {
    expect(decideAccess('/', false)).toBe('redirect')
    expect(decideAccess('/units/123', false)).toBe('redirect')
  })

  it('answers 401 for signed-out API calls', () => {
    expect(decideAccess('/api/units', false)).toBe('unauthorized')
  })

  it('lets anyone reach sign-in, health and the Auth.js endpoints', () => {
    expect(decideAccess('/sign-in', false)).toBe('allow')
    expect(decideAccess('/health', false)).toBe('allow')
    expect(decideAccess('/api/auth/callback/credentials', false)).toBe('allow')
  })

  it('does not treat look-alike paths as public', () => {
    expect(decideAccess('/sign-in-other', false)).toBe('redirect')
    expect(decideAccess('/api/authx', false)).toBe('unauthorized')
  })

  it('allows signed-in users everywhere', () => {
    expect(decideAccess('/units/123', true)).toBe('allow')
    expect(decideAccess('/api/units', true)).toBe('allow')
  })
})
