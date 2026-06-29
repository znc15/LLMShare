import { createFileRoute } from '@tanstack/react-router'
import { Waitlist } from '@/features/auth/waitlist'

export const Route = createFileRoute('/(auth)/waitlist')({
  component: Waitlist,
})
