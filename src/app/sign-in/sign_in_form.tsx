'use client'

import { useActionState, useEffect, useRef } from 'react'
import { ErrorIcon } from '../../ui/icons'
import { signInWithPassword, type SignInState } from './actions'

const INITIAL: SignInState = { failed: false, email: '' }

export function SignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState(signInWithPassword, INITIAL)
  const password = useRef<HTMLInputElement>(null)

  // On a failed attempt focus goes to the password, the field to retype (R27).
  useEffect(() => {
    if (state.failed) {
      password.current?.focus()
    }
  }, [state])

  return (
    <>
      {state.failed ? (
        <div className="notice err" role="alert">
          <ErrorIcon />
          <div>
            <b>Email or password is incorrect.</b>
            <br />
            Check both and try again. Accounts are created by an admin; there is no self sign-up.
          </div>
        </div>
      ) : null}
      <form action={action}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <div className="field">
          <label className="lbl" htmlFor="email">
            Email
          </label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={state.email}
            required
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="password">
            Password
          </label>
          <input
            ref={password}
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn primary" type="submit" aria-disabled={pending}>
          Sign in
        </button>
      </form>
    </>
  )
}
