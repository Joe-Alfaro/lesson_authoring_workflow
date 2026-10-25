import { auth } from '../../../auth/auth'
import { signCollabToken } from '../../../auth/collab_token'
import { isRole } from '../../../auth/roles'
import { getAuthSecret } from '../../../config/env'

export const dynamic = 'force-dynamic'

/** Issues a short-lived token the editor passes to the collab server (R27). */
export async function GET(): Promise<Response> {
  const session = await auth()
  const user = session?.user
  if (!user || !isRole(user.role)) {
    return Response.json({ error: 'Sign in required' }, { status: 401 })
  }
  const token = signCollabToken(user, getAuthSecret())
  return Response.json({ token }, { headers: { 'Cache-Control': 'no-store' } })
}
