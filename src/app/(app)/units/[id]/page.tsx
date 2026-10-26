import { notFound } from 'next/navigation'
import { requireRole } from '../../../../auth/require_role'
import { ROLES } from '../../../../auth/roles'
import { getDb } from '../../../../db/client'
import { UnitDashboard } from '../../../../ui/dashboard/unit_dashboard'
import { getUnitDashboardData } from '../../../../units/dashboard_data'

export const dynamic = 'force-dynamic'

/** The unit dashboard (R6, R9-R12, R24, R25); live updates re-render it via router.refresh(). */
export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ROLES)
  const { id } = await params
  const data = await getUnitDashboardData(getDb(), id)
  if (!data) {
    notFound()
  }
  return <UnitDashboard data={data} role={user.role} />
}
