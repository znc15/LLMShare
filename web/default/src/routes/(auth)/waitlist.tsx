import { createFileRoute } from '@tanstack/react-router'
import { Waitlist } from '@/features/auth/waitlist'

export const Route = createFileRoute('/(auth)/waitlist')({
  // provider/provider_user_id are appended when a person is routed here from a
  // full OAuth sign-up, carrying their OAuth identity for later re-binding.
  validateSearch: (search: Record<string, unknown>) => ({
    provider: (search.provider as string) || undefined,
    provider_user_id: (search.provider_user_id as string) || undefined,
  }),
  component: Waitlist,
})
