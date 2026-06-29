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

// Join the waitlist with an email-only signup.
export async function joinWaitlist(email: string): Promise<WaitlistJoinResponse> {
  const res = await api.post<WaitlistJoinResponse>('/api/waitlist/join', { email })
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
