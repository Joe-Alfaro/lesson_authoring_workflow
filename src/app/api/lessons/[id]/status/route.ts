import { eq } from 'drizzle-orm'
import { requireRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { lessons } from '../../../../../db/schema'
import { isUuid } from '../../../../../import/is_uuid'

export const dynamic = 'force-dynamic'

/**
 * R23 live status: open editors poll this every 2 s (D-050), so a status change reaches them
 * without holding a connection per tab. One indexed read; 304 while the ETag still matches.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requireRole(['author', 'reviewer', 'approver'])
  const { id } = await params
  const [row] = isUuid(id)
    ? await getDb().select({ status: lessons.status }).from(lessons).where(eq(lessons.id, id))
    : []
  if (!row) {
    return Response.json({ error: `Lesson ${id} does not exist.` }, { status: 404 })
  }
  const etag = `"${row.status}"`
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' }
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  return Response.json({ status: row.status }, { headers })
}
