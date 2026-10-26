import { eq } from 'drizzle-orm'
import type { Database } from '../db/client'
import { units } from '../db/schema'
import { NotFoundError } from '../generation/service'
import { isUuid } from '../import/is_uuid'

/** Throws NotFoundError (404) for an unknown or malformed unit id. */
export async function assertUnitExists(db: Database, unitId: string): Promise<void> {
  const [unit] = isUuid(unitId)
    ? await db.select({ id: units.id }).from(units).where(eq(units.id, unitId))
    : []
  if (!unit) {
    throw new NotFoundError(`Unit ${unitId}`)
  }
}
