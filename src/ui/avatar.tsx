import { avatarColour, initials } from './people'

// One implementation of initials and colours (src/ui/people.ts), shared with the editor.
export { avatarColour, initials }

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
