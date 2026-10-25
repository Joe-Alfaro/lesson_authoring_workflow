import Link from 'next/link'
import { signOut } from '../auth/auth'
import type { SessionUser } from '../auth/credentials'
import { MainNav } from './main_nav'
import { avatarColour, initials } from './people'

const ROLE_LABELS: Record<SessionUser['role'], string> = {
  author: 'Author',
  reviewer: 'Reviewer',
  approver: 'Approver',
  admin: 'Admin',
}

/** The 56px app bar: product mark, main nav and the signed-in user with a role chip. */
export function TopBar({ user }: { user: SessionUser }) {
  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/sign-in' })
  }

  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        Lesson Studio
      </Link>
      <MainNav />
      <span className="spacer" />
      <div className="me">
        <span>{user.name}</span>
        <span className="role">{ROLE_LABELS[user.role]}</span>
        <span className={`av ${avatarColour(user.id)}`} aria-hidden="true">
          {initials(user.name)}
        </span>
        <form action={handleSignOut}>
          <button className="btn quiet sm" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
