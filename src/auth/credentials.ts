import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { Database } from '../db/client'
import { users } from '../db/schema'
import type { Role } from './roles'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role
}

/** Returns the user when the email and password match a seeded account, otherwise null. */
export async function verifyCredentials(
  db: Database,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()))
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return null
  }
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}
