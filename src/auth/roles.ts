import type { Role } from '../db/schema'

export type { Role }

export const ROLES: readonly Role[] = ['author', 'reviewer', 'approver', 'admin']

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Admins can do everything (roles table), so they pass every role check. */
export function hasRole(role: Role, allowed: readonly Role[]): boolean {
  return role === 'admin' || allowed.includes(role)
}
