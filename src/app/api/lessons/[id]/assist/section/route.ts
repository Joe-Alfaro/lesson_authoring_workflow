import { getAssistProvider } from '../../../../../../assist/provider'
import { assistErrorResponse, optionalString, requiredString } from '../../../../../../assist/http'
import { regenerateSection } from '../../../../../../assist/service'
import { requireRole } from '../../../../../../auth/require_role'
import { getDb } from '../../../../../../db/client'
import { readJsonObject } from '../../../../../../workflow/http'

export const dynamic = 'force-dynamic'

/** R21: a proposed replacement for one section. Nothing is written to the lesson. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireRole(['reviewer', 'approver'])
  const { id } = await params
  try {
    const body = await readJsonObject(request)
    const sectionId = requiredString(body, 'sectionId')
    const instruction = optionalString(body, 'instruction')
    const { section } = await regenerateSection(
      { db: getDb(), ...getAssistProvider() },
      { lessonId: id, actor: { id: user.id, role: user.role }, sectionId, instruction },
    )
    return Response.json({ section })
  } catch (error) {
    return assistErrorResponse(error)
  }
}
