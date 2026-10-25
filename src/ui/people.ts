// How people appear in the interface: initials and a stable collaborator colour (STYLE.md).

export const COLLABORATOR_COLOURS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] as const

/** Hex values of the collaborator colours (remote carets need them inline). */
export const COLLABORATOR_HEX: Record<(typeof COLLABORATOR_COLOURS)[number], string> = {
  c1: '#7c3aed',
  c2: '#0e7490',
  c3: '#be185d',
  c4: '#4d7c0f',
  c5: '#c2410c',
  c6: '#1d4ed8',
}

/** "Author 01" -> "A1": first letter of the first word plus the trailing number, if any. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  const first = words[0]?.[0] ?? '?'
  const last = words.length > 1 ? words[words.length - 1]! : ''
  const second = /^\d+$/.test(last) ? String(Number(last)) : (last[0] ?? '')
  return `${first}${second}`.toUpperCase()
}

/** A stable collaborator colour per user, so the same person keeps one colour everywhere. */
export function avatarColour(id: string): (typeof COLLABORATOR_COLOURS)[number] {
  const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0)
  return COLLABORATOR_COLOURS[sum % COLLABORATOR_COLOURS.length]!
}
