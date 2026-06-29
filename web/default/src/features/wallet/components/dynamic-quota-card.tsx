import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Gauge, Info } from 'lucide-react'
import { api } from '@/lib/api'

interface MyDynamicQuota {
  enabled: boolean
  hourly_quota: number // cents
  hour_used: number
  hour_remaining: number
  demand_24h: number
  weight: number
  inactivity_days: number
  days_until_eviction: number
}

export function DynamicQuotaCard() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['my-dynamic-quota'],
    queryFn: async () => {
      const res = await api.get<{ data: MyDynamicQuota }>(
        '/api/user/dynamic_quota'
      )
      return res.data.data
    },
    refetchInterval: 30000,
  })

  // Hidden entirely when dynamic quota is off — the card only makes sense then.
  if (!isLoading && !data?.enabled) return null

  const usedPct =
    data && data.hourly_quota > 0
      ? Math.min(100, Math.round((data.hour_used / data.hourly_quota) * 100))
      : 0
  const remainingTone =
    usedPct >= 90
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-emerald-600 dark:text-emerald-400'

  return (
    <div className='bg-card overflow-hidden rounded-xl border'>
      <div className='from-primary/10 to-transparent flex items-center justify-between border-b bg-gradient-to-r px-5 py-4'>
        <div className='flex items-center gap-2'>
          <Gauge className='text-primary h-5 w-5' />
          <h3 className='text-base font-semibold'>
            {t('Dynamic Quota')}
          </h3>
        </div>
        <div className='text-muted-foreground text-xs'>
          {t('Refreshed hourly by your usage')}
        </div>
      </div>

      <div className='p-5'>
        {isLoading ? (
          <div className='text-muted-foreground animate-pulse py-4 text-center text-sm'>
            {t('Loading…')}
          </div>
        ) : data ? (
          <div className='flex flex-col gap-4'>
            {/* Headline: remaining this hour */}
            <div className='flex items-baseline justify-between'>
              <div>
                <div className='text-muted-foreground text-xs font-medium'>
                  {t('Remaining this hour')}
                </div>
                <div
                  className={`text-3xl font-extrabold tabular-nums ${remainingTone}`}
                >
                  ${(data.hour_remaining / 100).toFixed(2)}
                </div>
              </div>
              <div className='text-right'>
                <div className='text-muted-foreground text-xs font-medium'>
                  {t('Hourly Quota')}
                </div>
                <div className='text-foreground text-lg font-semibold tabular-nums'>
                  ${(data.hourly_quota / 100).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Usage progress bar */}
            <div>
              <div className='mb-1 flex items-center justify-between text-xs'>
                <span className='text-muted-foreground'>{t('Used')}</span>
                <span className='tabular-nums'>
                  ${(data.hour_used / 100).toFixed(2)} ({usedPct}%)
                </span>
              </div>
              <div className='bg-muted h-2 overflow-hidden rounded-full'>
                <div
                  className={`h-full rounded-full transition-all ${
                    usedPct >= 90 ? 'bg-amber-500' : 'bg-primary'
                  }`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            </div>

            {/* Secondary stats */}
            <div className='grid grid-cols-3 gap-3 border-t pt-4'>
              <MiniStat
                label={t('24h Demand')}
                value={`$${(data.demand_24h / 100).toFixed(2)}`}
              />
              <MiniStat
                label={t('Demand Weight')}
                value={`${data.weight.toFixed(1)}%`}
              />
              <MiniStat
                label={t('Eviction in')}
                value={
                  data.days_until_eviction >= 0
                    ? `${data.days_until_eviction}d`
                    : '—'
                }
              />
            </div>

            {/* Explainer */}
            <div className='text-muted-foreground flex items-start gap-1.5 text-xs leading-relaxed'>
              <Info className='mt-0.5 h-3.5 w-3.5 shrink-0' />
              <span>
                {t(
                  'Your quota is recomputed every hour based on your recent usage. Use more to get more (up to the cap); stay idle and it drops to the floor. No requests for {{n}} days removes your account.',
                  { n: data.inactivity_days }
                )}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className='text-center'>
      <div className='text-muted-foreground text-xs'>{label}</div>
      <div className='mt-0.5 font-semibold tabular-nums'>{value}</div>
    </div>
  )
}
