import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { userRole } from '../db/schema'
import type { SessionUser } from './credentials'

const VERSION = 'v1'
const DEFAULT_TTL_SECONDS = 10 * 60

const payloadSchema = z.object({
  id: z.string().min(1),
  email: z.string(),
  name: z.string(),
  role: z.enum(userRole.enumValues),
  exp: z.number().int(),
})

// A key derived for this purpose only, so a collab token can't be confused with other uses of
// AUTH_SECRET.
function sign(data: string, secret: string): Buffer {
  const key = createHmac('sha256', secret).update('collab-token').digest()
  return createHmac('sha256', key).update(data).digest()
}

/**
 * Short-lived token the web app gives a signed-in user so the collab server (a separate process
 * sharing AUTH_SECRET) can authenticate their WebSocket connection (R27).
 */
export function signCollabToken(
  user: SessionUser,
  secret: string,
  { now = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS } = {},
): string {
  const payload = { id: user.id, email: user.email, name: user.name, role: user.role }
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlSeconds * 1000 })).toString(
    'base64url',
  )
  return `${VERSION}.${body}.${sign(`${VERSION}.${body}`, secret).toString('base64url')}`
}

/** Returns the user for a valid, unexpired token, otherwise null. */
export function verifyCollabToken(
  token: string,
  secret: string,
  now = Date.now(),
): SessionUser | null {
  const [version, body, signature, ...rest] = token.split('.')
  if (version !== VERSION || !body || !signature || rest.length > 0) {
    return null
  }
  const expected = sign(`${version}.${body}`, secret)
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const parsed = payloadSchema.safeParse(decoded)
  if (!parsed.success || parsed.data.exp <= now) {
    return null
  }
  const { id, email, name, role } = parsed.data
  return { id, email, name, role }
}
