import { verifyCollabToken } from '../auth/collab_token'
import type { SessionUser } from '../auth/credentials'

/** Connection context for later per-document checks (assignment, approved lessons). */
export interface CollabContext {
  user: SessionUser
}

/** Hocuspocus closes the connection when onAuthenticate throws, before any sync or load. */
export function authenticateConnection(token: string, secret: string): CollabContext {
  const user = token ? verifyCollabToken(token, secret) : null
  if (!user) {
    throw new Error('A valid collab token is required')
  }
  return { user }
}
