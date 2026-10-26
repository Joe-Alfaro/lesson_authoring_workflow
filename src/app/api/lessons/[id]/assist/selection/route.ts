import { getAssistProvider } from '../../../../../../assist/provider'
import { assistErrorResponse, optionalString, requiredString } from '../../../../../../assist/http'
import { suggestSelection, type SelectionAction } from '../../../../../../assist/service'
import { requireRole } from '../../../../../../auth/require_role'
import { getDb } from '../../../../../../db/client'
import { readJsonObject } from '../../../../../../workflow/http'

export const dynamic = 'force-dynamic'

/** R20: a suggestion for the selected text. Nothing is written to the lesson. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireRole(['reviewer', 'approver'])
  const { id } = await params
  try {
    const body = await readJsonObject(request)
    const action = requiredString(body, 'action') as SelectionAction
    const text = requiredString(body, 'text')
    const instruction = optionalString(body, 'instruction')
    const blockId = optionalString(body, 'blockId')
    const { suggestion } = await suggestSelection(
      { db: getDb(), ...getAssistProvider() },
      { lessonId: id, actor: { id: user.id, role: user.role }, action, text, instruction, blockId },
    )
    return Response.json({ suggestion })
  } catch (error) {
    return assistErrorResponse(error)
  }
}
