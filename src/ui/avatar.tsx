const AVATAR_COLOURS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']

/** "Author 01" -> "A1": first letter of the first word plus the trailing number, if any. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  const first = words[0]?.[0] ?? '?'
  const last = words.length > 1 ? words[words.length - 1]! : ''
  const second = /^\d+$/.test(last) ? String(Number(last)) : (last[0] ?? '')
  return `${first}${second}`.toUpperCase()
}

/** A stable collaborator colour per user, so the same person keeps one colour everywhere. */
export function avatarColour(id: string): string {
  const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0)
  return AVATAR_COLOURS[sum % AVATAR_COLOURS.length]!
}

/** A small avatar and the person's name, as in the lesson table's Assignee column. */
export function Who({ person }: { person: { id: string; name: string } }) {
  return (
    <span className="who">
      <span className={`av sm ${avatarColour(person.id)}`} aria-hidden="true">
        {initials(person.name)}
      </span>
      {person.name}
    </span>
  )
}
