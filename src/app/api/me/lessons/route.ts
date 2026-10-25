import { requireRole } from '../../../../auth/require_role'
import { getDb } from '../../../../db/client'
import { getMyLessons } from '../../../../workflow/dashboard'

export const dynamic = 'force-dynamic'

/** R25: "My lessons" for the session user. Typed as a route handler without an unused request parameter. */
export const GET: (request: Request) => Promise<Response> = async () => {
  const user = await requireRole(['author', 'reviewer', 'approver'])
  return Response.json(await getMyLessons(getDb(), user.id))
}
