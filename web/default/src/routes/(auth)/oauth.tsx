/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useEffect } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import i18next from 'i18next'
import { toast } from 'sonner'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'
import { getSelf } from '@/lib/api'
import { wechatLoginByCode } from '@/features/auth/api'

function OAuthComponent() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/(auth)/oauth' }) as {
    redirect?: string
    provider?: 'github' | 'discord' | 'oidc' | 'linuxdo' | 'telegram' | 'wechat'
    code?: string
    state?: string
  }

  useEffect(() => {
    ;(async () => {
      try {
        if (search?.provider === 'wechat' && search.code) {
          const res = await wechatLoginByCode(search.code)
          // Pool full: route to the waitlist with the WeChat identity, do not
          // attempt to log in (no account was created).
          const data = (res?.data ?? null) as {
            waitlisted?: boolean
            provider?: string
            provider_user_id?: string
          } | null
          if (!res?.success && data?.waitlisted) {
            toast.info(i18next.t('The user pool is full. You have been added to the waitlist.'))
            const params = new URLSearchParams()
            if (data.provider) params.set('provider', data.provider)
            if (data.provider_user_id) params.set('provider_user_id', data.provider_user_id)
            navigate({ to: `/waitlist?${params.toString()}`, replace: true })
            return
          }
        }
        const res = await getSelf()
        if (res?.success) {
          useAuthStore.getState().auth.setUser(res.data as AuthUser)
          const target = search?.redirect || '/dashboard'
          navigate({ to: target, replace: true })
          return
        }
      } catch {
        /* empty */
      }
      toast.error(i18next.t('OAuth failed'))
      navigate({ to: '/sign-in', replace: true })
    })()
  }, [navigate, search])

  return null
}

export const Route = createFileRoute('/(auth)/oauth')({
  component: OAuthComponent,
})
