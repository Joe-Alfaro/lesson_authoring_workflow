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
