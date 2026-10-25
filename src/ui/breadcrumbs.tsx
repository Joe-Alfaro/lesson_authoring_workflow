import Link from 'next/link'

interface Crumb {
  label: string
  href?: string
}

/**
 * "Units / Import". Each crumb is its own list item, so the link isn't part of a run of text and
 * doesn't need an underline to be told apart (the mockups draw none).
 */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="crumbs">
        {trail.map(({ label, href }) => (
          <li key={label} aria-current={href ? undefined : 'page'}>
            {href ? <Link href={href}>{label}</Link> : label}
          </li>
        ))}
      </ol>
    </nav>
  )
}
