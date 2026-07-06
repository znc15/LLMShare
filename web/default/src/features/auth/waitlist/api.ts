import { api } from '@/lib/api'

export interface WaitlistJoinResponse {
  success: boolean
  message: string
  position?: number
  status?: string
}

export interface WaitlistStatusResponse {
  success: boolean
  message?: string
  position: number
  status: string
}

export interface ActivatePayload {
  token: string
  username: string
  password: string
}

export interface ActivateResponse {
  success: boolean
  message: string
}

// Join the waitlist with an email-only signup. providerName/providerUserId are
// supplied when routed from a full OAuth sign-up, so the OAuth identity can be
// re-bound to the account at activation.
export async function joinWaitlist(
  email: string,
  providerName?: string,
  providerUserId?: string,
): Promise<WaitlistJoinResponse> {
  const res = await api.post<WaitlistJoinResponse>('/api/waitlist/join', {
    email,
    ...(providerName ? { provider_name: providerName } : {}),
    ...(providerUserId ? { provider_user_id: providerUserId } : {}),
  })
  return res.data
}

// Check the queue position for an email.
export async function getWaitlistStatus(email: string): Promise<WaitlistStatusResponse> {
  const res = await api.post<WaitlistStatusResponse>('/api/waitlist/status', { email })
  return res.data
}

// Consume a magic-link token and create the account.
export async function activateByMagicLink(payload: ActivatePayload): Promise<ActivateResponse> {
  const res = await api.post<ActivateResponse>('/api/activate', payload)
  return res.data
}
