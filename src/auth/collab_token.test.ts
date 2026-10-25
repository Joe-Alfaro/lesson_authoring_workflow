import { describe, expect, it } from 'vitest'
import { signCollabToken, verifyCollabToken } from './collab_token'

const SECRET = 'test-secret-with-enough-entropy'
const USER = {
  id: '6f1c2a8e-1d7b-4f0a-9a43-0d2a7b2f9e11',
  email: 'reviewer01@example.com',
  name: 'Reviewer 01',
  role: 'reviewer' as const,
}
const NOW = 1_800_000_000_000

describe('collab token', () => {
  it('round-trips the user while it is valid', () => {
    const token = signCollabToken(USER, SECRET, { now: NOW, ttlSeconds: 600 })
    expect(verifyCollabToken(token, SECRET, NOW + 599_000)).toEqual(USER)
  })

  it('rejects an expired token', () => {
    const token = signCollabToken(USER, SECRET, { now: NOW, ttlSeconds: 600 })
    expect(verifyCollabToken(token, SECRET, NOW + 600_000)).toBeNull()
  })

  it('rejects a token signed with another secret', () => {
    const token = signCollabToken(USER, 'other-secret', { now: NOW })
    expect(verifyCollabToken(token, SECRET, NOW)).toBeNull()
  })

  it('rejects a token whose payload was changed', () => {
    const token = signCollabToken(USER, SECRET, { now: NOW })
    const [version, , signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...USER, role: 'admin', exp: NOW })).toString(
      'base64url',
    )
    expect(verifyCollabToken(`${version}.${forged}.${signature}`, SECRET, NOW)).toBeNull()
  })

  it.each(['', 'garbage', 'v1.x.y', 'v1..', 'v2.a.b'])('rejects malformed token %j', (token) => {
    expect(verifyCollabToken(token, SECRET, NOW)).toBeNull()
  })
})
