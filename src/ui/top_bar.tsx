import Link from 'next/link'
import { signOut } from '../auth/auth'
import type { SessionUser } from '../auth/credentials'
import { MainNav } from './main_nav'

const ROLE_LABELS: Record<SessionUser['role'], string> = {
  author: 'Author',
  reviewer: 'Reviewer',
  approver: 'Approver',
  admin: 'Admin',
}

const AVATAR_COLOURS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']

/** "Author 01" -> "A1": first letter of the first word plus the trailing number, if any. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  const first = words[0]?.[0] ?? '?'
  const last = words.length > 1 ? words[words.length - 1]! : ''
  const second = /^\d+$/.test(last) ? String(Number(last)) : (last[0] ?? '')
  return `${first}${second}`.toUpperCase()
}

/** A stable collaborator colour per user, so the same person keeps one colour everywhere. */
function avatarColour(id: string): string {
  const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0)
  return AVATAR_COLOURS[sum % AVATAR_COLOURS.length]!
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
