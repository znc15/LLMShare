import { api } from '@/lib/api'

export interface ActivatePayload {
  token: string
  username: string
  password: string
}

export interface ActivateResponse {
  success: boolean
  message: string
}

// Consume a magic-link token and create the account.
export async function activateByMagicLink(payload: ActivatePayload): Promise<ActivateResponse> {
  const res = await api.post<ActivateResponse>('/api/activate', payload)
  return res.data
}
