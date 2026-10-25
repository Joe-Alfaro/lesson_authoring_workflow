import { describe, expect, it } from 'vitest'
import { signCollabToken } from '../auth/collab_token'
import { authenticateConnection } from './authenticate'

const SECRET = 'secret'
const USER = {
  id: 'u1',
  email: 'approver01@example.com',
  name: 'Approver 01',
  role: 'approver' as const,
}

describe('authenticateConnection', () => {
  it('puts the user and role into the connection context', () => {
    expect(authenticateConnection(signCollabToken(USER, SECRET), SECRET)).toEqual({ user: USER })
  })

  it('throws for a missing or invalid token', () => {
    expect(() => authenticateConnection('', SECRET)).toThrow(/token/)
    expect(() => authenticateConnection('v1.a.b', SECRET)).toThrow(/token/)
  })
})
