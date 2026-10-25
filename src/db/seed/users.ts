import bcrypt from 'bcryptjs'
import { sql } from 'drizzle-orm'
import type { Database } from '../client'
import { users, type Role } from '../schema'

export interface SeedUser {
  email: string
  name: string
  role: Role
}

function numbered(role: Role, label: string, count: number): SeedUser[] {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')
    return {
      email: `${role}${number}@example.com`,
      name: `${label} ${number}`,
      role,
    }
  })
}

/** R27: 1 admin, 2 authors, 2 approvers and 20 reviewers. */
export const SEED_USERS: readonly SeedUser[] = [
  { email: 'admin@example.com', name: 'Admin', role: 'admin' },
  ...numbered('author', 'Author', 2),
  ...numbered('approver', 'Approver', 2),
  ...numbered('reviewer', 'Reviewer', 20),
]

/** Upserts the demo accounts; re-running resets their names, roles and password. */
export async function seedUsers(db: Database, password: string): Promise<number> {
  const passwordHash = await bcrypt.hash(password, 10)
  const rows = SEED_USERS.map((user) => ({ ...user, passwordHash }))
  await db
    .insert(users)
    .values(rows)
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: sql`excluded.name`,
        role: sql`excluded.role`,
        passwordHash: sql`excluded.password_hash`,
      },
    })
  return rows.length
}
