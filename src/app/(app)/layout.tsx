import type { ReactNode } from 'react'
import { requireRole } from '../../auth/require_role'
import { ROLES } from '../../auth/roles'
import { TopBar } from '../../ui/top_bar'

/** Signed-in pages share the top bar (docs/design/lesson-authoring.md, Shared layout). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireRole(ROLES)
  return (
    <>
      <TopBar user={user} />
      {children}
    </>
  )
}
