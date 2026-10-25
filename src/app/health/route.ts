import { getPool } from '../../db/client'
import { checkHealth, healthStatusCode } from '../../db/health'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const report = await checkHealth(getPool())
  return Response.json(report, { status: healthStatusCode(report) })
}
