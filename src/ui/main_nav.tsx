'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  // Home shows the Units list, so it counts as the Units section.
  { href: '/units', label: 'Units', alsoAt: '/' },
  { href: '/my-lessons', label: 'My lessons' },
  { href: '/prompts', label: 'Prompts' },
]

/** The top bar's main nav; the section holding the current page gets aria-current. */
export function MainNav() {
  const pathname = usePathname()
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map(({ href, label, alsoAt }) => {
        const current = pathname === href || pathname === alsoAt || pathname.startsWith(`${href}/`)
        return (
          <Link key={href} href={href} aria-current={current ? 'page' : undefined}>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
