'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** A unit's prompt editor lives under the unit but belongs to the Prompts section. */
const PROMPT_EDITOR = /^\/units\/[^/]+\/prompt\/?$/

const LINKS = [
  {
    href: '/units',
    label: 'Units',
    // Home shows the Units list, so it counts as the Units section.
    isCurrent: (path: string) =>
      path === '/' ||
      ((path === '/units' || path.startsWith('/units/')) && !PROMPT_EDITOR.test(path)),
  },
  {
    href: '/my-lessons',
    label: 'My lessons',
    isCurrent: (path: string) => path === '/my-lessons' || path.startsWith('/my-lessons/'),
  },
  {
    href: '/prompts',
    label: 'Prompts',
    isCurrent: (path: string) =>
      path === '/prompts' || path.startsWith('/prompts/') || PROMPT_EDITOR.test(path),
  },
]

/** The top bar's main nav; the section holding the current page gets aria-current. */
export function MainNav() {
  const pathname = usePathname()
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map(({ href, label, isCurrent }) => (
        <Link key={href} href={href} aria-current={isCurrent(pathname) ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  )
}
