import { forbidden, redirect } from 'next/navigation'
import { auth } from './auth'
import type { SessionUser } from './credentials'
import { hasRole, isRole, type Role } from './roles'

/**
 * Server-side role check for pages, server actions and route handlers (R27). Redirects to
 * sign-in without a session and answers 403 when the role is not allowed; admins always pass.
 */
export async function requireRole(allowed: readonly Role[]): Promise<SessionUser> {
  const session = await auth()
  const user = session?.user
  if (!user) {
    redirect('/sign-in')
  }
  if (!isRole(user.role) || !hasRole(user.role, allowed)) {
    forbidden()
  }
  return user
}

const ROLE_NAMES: Record<Role, string> = {
  author: 'authors',
  reviewer: 'reviewers',
  approver: 'approvers',
  admin: 'admins',
}

/**
 * The route-handler form of requireRole (D-032 (4)): the signed-in user, or a JSON `{ error }`
 * answer to return as is: 401 without a session, 403 for a role that isn't allowed. Admins always
 * pass, so `[]` means admins only.
 */
export async function requireApiRole(allowed: readonly Role[]): Promise<SessionUser | Response> {
  const session = await auth()
  const user = session?.user
  if (!user) {
    return Response.json({ error: 'Sign in required' }, { status: 401 })
  }
  if (!isRole(user.role) || !hasRole(user.role, allowed)) {
    const who = [...allowed.map((role) => ROLE_NAMES[role]), 'admins'].join(', ')
    const role = isRole(user.role) ? user.role : 'unknown'
    return Response.json(
      { error: `Your role (${role}) can't do this; it is for ${who}.` },
      { status: 403 },
    )
  }
  return user
}
