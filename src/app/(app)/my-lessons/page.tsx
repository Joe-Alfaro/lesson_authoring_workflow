import { requireRole } from '../../../auth/require_role'
import { ROLES } from '../../../auth/roles'
import { getDb } from '../../../db/client'
import { MyLessons } from '../../../ui/dashboard/my_lessons'
import { getMyLessonsData } from '../../../units/dashboard_data'

export const dynamic = 'force-dynamic'

/** R25: a reviewer's assigned lessons, grouped by unit. */
export default async function MyLessonsPage() {
  const user = await requireRole(ROLES)
  return <MyLessons data={await getMyLessonsData(getDb(), user.id)} userName={user.name} />
}
