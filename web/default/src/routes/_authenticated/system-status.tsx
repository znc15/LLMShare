import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { SystemStatus } from '@/features/system-status'

export const Route = createFileRoute('/_authenticated/system-status')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    // System status exposes pool-level data — admin-only.
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
  },
  component: SystemStatus,
})
