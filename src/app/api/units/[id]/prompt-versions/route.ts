import { requireRole } from '../../../../../auth/require_role'
import { getDb } from '../../../../../db/client'
import { generationErrorResponse } from '../../../../../generation_api/http'
import { assertUnitExists } from '../../../../../generation_api/units'
import { PromptTemplate } from '../../../../../generation/prompt_template'
import {
  getCurrentPromptVersion,
  listPromptVersions,
  savePromptVersion,
} from '../../../../../generation/prompt_versions'
import { readJsonObject } from '../../../../../workflow/http'

export const dynamic = 'force-dynamic'

/** R10: the unit's prompt versions, oldest first (version 1 is created on first read). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requireRole(['author'])
  const { id } = await params
  try {
    const db = getDb()
    await assertUnitExists(db, id)
    await getCurrentPromptVersion(db, id)
    return Response.json({ versions: await listPromptVersions(db, id) })
  } catch (error) {
    return generationErrorResponse(error)
  }
}

/** R10: saves the template as the next version. Body `{ template }` -> 201 version. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireRole(['author'])
  const { id } = await params
  try {
    const body = await readJsonObject(request)
    const template = PromptTemplate.parse(body.template)
    const db = getDb()
    await assertUnitExists(db, id)
    const version = await savePromptVersion(db, { unitId: id, template, userId: user.id })
    return Response.json(version, { status: 201 })
  } catch (error) {
    return generationErrorResponse(error)
  }
}
