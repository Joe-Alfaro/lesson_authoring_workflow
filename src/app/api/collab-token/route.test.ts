import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyCollabToken } from '../../../auth/collab_token'

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('../../../auth/auth', () => ({ auth }))

const { GET } = await import('./route')

describe('GET /api/collab-token', () => {
  beforeEach(() => {
    auth.mockReset()
    vi.stubEnv('AUTH_SECRET', 'route-test-secret')
  })

  it('answers 401 without a session', async () => {
    auth.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it('issues a token the collab server accepts for the signed-in user', async () => {
    const user = { id: 'u1', email: 'author01@example.com', name: 'Author 01', role: 'author' }
    auth.mockResolvedValue({ user, expires: '2099-01-01T00:00:00.000Z' })

    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const { token } = (await response.json()) as { token: string }
    expect(verifyCollabToken(token, 'route-test-secret')).toEqual(user)
  })
})
