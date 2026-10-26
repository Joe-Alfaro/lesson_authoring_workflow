import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from './roles'

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))

vi.mock('./auth', () => ({ auth }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  forbidden: () => {
    throw new Error('forbidden')
  },
}))

const { requireApiRole, requireRole } = await import('./require_role')

function signedInAs(role: Role) {
  auth.mockResolvedValue({
    user: { id: 'user-1', email: `${role}@example.com`, name: role, role },
    expires: '2099-01-01T00:00:00.000Z',
  })
}

describe('requireRole', () => {
  beforeEach(() => {
    auth.mockReset()
  })

  it('redirects to sign-in when there is no session', async () => {
    auth.mockResolvedValue(null)
    await expect(requireRole(['author'])).rejects.toThrow('redirect:/sign-in')
  })

  it('returns the user when their role is allowed', async () => {
    signedInAs('approver')
    await expect(requireRole(['approver'])).resolves.toMatchObject({
      id: 'user-1',
      role: 'approver',
    })
  })

  it('responds 403 when the role is not allowed', async () => {
    signedInAs('reviewer')
    await expect(requireRole(['approver'])).rejects.toThrow('forbidden')
  })

  it('lets admins through every check', async () => {
    signedInAs('admin')
    await expect(requireRole(['author'])).resolves.toMatchObject({ role: 'admin' })
  })

  it('rejects a session without a valid role', async () => {
    auth.mockResolvedValue({ user: { id: 'user-1', role: 'owner' }, expires: '2099-01-01' })
    await expect(requireRole(['author'])).rejects.toThrow('forbidden')
  })
})

describe('requireApiRole (route handlers, D-032 (4))', () => {
  beforeEach(() => {
    auth.mockReset()
  })

  async function json(response: unknown) {
    expect(response).toBeInstanceOf(Response)
    const answer = response as Response
    return {
      status: answer.status,
      type: answer.headers.get('content-type'),
      body: (await answer.json()) as unknown,
    }
  }

  it('answers 401 JSON without a session', async () => {
    auth.mockResolvedValue(null)
    expect(await json(await requireApiRole(['author']))).toEqual({
      status: 401,
      type: expect.stringContaining('application/json'),
      body: { error: 'Sign in required' },
    })
  })

  it('answers 403 JSON when the role is not allowed, or the session has no valid role', async () => {
    signedInAs('reviewer')
    expect(await json(await requireApiRole(['approver']))).toEqual({
      status: 403,
      type: expect.stringContaining('application/json'),
      body: { error: expect.stringContaining('reviewer') },
    })
    auth.mockResolvedValue({ user: { id: 'user-1', role: 'owner' }, expires: '2099-01-01' })
    expect((await json(await requireApiRole(['author']))).status).toBe(403)
  })

  it('returns the user when the role is allowed, admins included', async () => {
    signedInAs('author')
    await expect(requireApiRole(['author'])).resolves.toMatchObject({ role: 'author' })
    signedInAs('admin')
    await expect(requireApiRole([])).resolves.toMatchObject({ role: 'admin' })
  })
})
