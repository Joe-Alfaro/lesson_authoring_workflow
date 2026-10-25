import { signOut } from '../auth/auth'
import { requireRole } from '../auth/require_role'
import { ROLES } from '../auth/roles'

export default async function HomePage() {
  const user = await requireRole(ROLES)

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/sign-in' })
  }

  return (
    <main>
      <h1>Lesson authoring</h1>
      <p>
        Signed in as {user.name} ({user.email}), role: <strong>{user.role}</strong>.
      </p>
      <form action={handleSignOut}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  )
}
