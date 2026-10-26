import { getAssistProvider } from '../../../../../../assist/provider'
import { assistErrorResponse } from '../../../../../../assist/http'
import { checkAlignment } from '../../../../../../assist/service'
import { requireRole } from '../../../../../../auth/require_role'
import { getDb } from '../../../../../../db/client'

export const dynamic = 'force-dynamic'

/** R22: how the lesson addresses each focus standard. Results are not stored. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireRole(['reviewer', 'approver'])
  const { id } = await params
  try {
    const { checkedAt, standards } = await checkAlignment(
      { db: getDb(), ...getAssistProvider() },
      { lessonId: id, actor: { id: user.id, role: user.role } },
    )
    return Response.json({ checkedAt: checkedAt.toISOString(), standards })
  } catch (error) {
    return assistErrorResponse(error)
  }
}
