import { api } from '@/lib/api'

export interface SystemStatusChannel {
  channel_id: number
  name: string
  hourly_spent: number
  daily_spent: number
  request_count: number
}

export interface SystemStatusTick {
  last_run_at: string
  next_run_at: string
  evictions: number
  promotions: number
  last_error: string
  running: boolean
}

export interface SystemStatusData {
  enabled: boolean
  config: {
    pool_b_cents: number
    floor_f_cents: number
    cap_c_cents: number
    lookback_hours: number
    inactivity_days: number
    total_user_cap: number
    channel_cap_cents: number
    channel_cap_period: string
  }
  pool: {
    active_users: number
    waitlist_size: number
    slots_remaining: number
    total_allocated: number
    total_used: number
    average_quota: number
    at_cap_users: number
    expected_per_user: number
  }
  channels: SystemStatusChannel[]
  tick: SystemStatusTick
}

export interface SystemStatusResponse {
  success: boolean
  data: SystemStatusData
}

// Fetch the dynamic-quota overview (pool stats, expected quota, channels).
export async function getSystemStatus(): Promise<SystemStatusData> {
  const res = await api.get<SystemStatusResponse>('/api/dynamic_quota/overview')
  return res.data.data
}
