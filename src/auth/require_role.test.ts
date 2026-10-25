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

const { requireRole } = await import('./require_role')

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
