'use server'

import { AuthError } from 'next-auth'
import { signIn } from '../../auth/auth'

export interface SignInState {
  failed: boolean
  email: string
}

/** Only same-site paths, so the callback can't send users to another origin. */
function safeCallback(callbackUrl: FormDataEntryValue | null): string {
  if (
    typeof callbackUrl === 'string' &&
    callbackUrl.startsWith('/') &&
    !callbackUrl.startsWith('//')
  ) {
    return callbackUrl
  }
  return '/'
}

/** R27: email and password against the seeded accounts; redirects to the callback on success. */
export async function signInWithPassword(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = formData.get('email')
  try {
    await signIn('credentials', {
      email,
      password: formData.get('password'),
      redirectTo: safeCallback(formData.get('callbackUrl')),
    })
  } catch (caught) {
    // signIn redirects by throwing on success; only credential failures are handled here.
    if (caught instanceof AuthError) {
      return { failed: true, email: typeof email === 'string' ? email : '' }
    }
    throw caught
  }
  return { failed: false, email: '' }
}
