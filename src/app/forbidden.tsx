import Link from 'next/link'

export default function Forbidden() {
  return (
    <main>
      <h1>Not allowed</h1>
      <p>Your role does not allow this action.</p>
      <Link href="/">Back to home</Link>
    </main>
  )
}
