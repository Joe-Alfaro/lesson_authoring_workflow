import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'
import { signIn } from '../../auth/auth'

interface SignInPageProps {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>
}

/** Only same-site paths, so the callback can't send users to another origin. */
function safeCallback(callbackUrl: string | undefined): string {
  if (callbackUrl?.startsWith('/') && !callbackUrl.startsWith('//')) {
    return callbackUrl
  }
  return '/'
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error, callbackUrl } = await searchParams
  const redirectTo = safeCallback(callbackUrl)

  async function handleSignIn(formData: FormData) {
    'use server'
    try {
      await signIn('credentials', {
        email: formData.get('email'),
        password: formData.get('password'),
        redirectTo,
      })
    } catch (caught) {
      // signIn redirects by throwing on success; only credential failures are handled here.
      if (caught instanceof AuthError) {
        redirect(`/sign-in?error=1&callbackUrl=${encodeURIComponent(redirectTo)}`)
      }
      throw caught
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      {error ? <p className="error">Email or password is incorrect.</p> : null}
      <form action={handleSignIn}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  )
}
