import { PacingRibbon } from '../../ui/ribbon'
import { SignInForm } from './sign_in_form'

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string }>
}

/** R27 sign-in. Mockups: docs/design/lesson-authoring/R27-sign-in.html, R27-sign-in-error.html. */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl } = await searchParams

  return (
    <main className="signin">
      <div className="card">
        <PacingRibbon />
        <h1>Lesson Studio</h1>
        <p className="sub lede">Sign in to write, review and approve unit lessons.</p>
        <SignInForm callbackUrl={callbackUrl ?? '/'} />
      </div>
    </main>
  )
}
