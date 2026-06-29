import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Gauge,
  Radio,
  Timer,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { SectionPageLayout } from '@/components/layout'
import { getSystemStatus } from './api'

// quota units -> USD string. NewAPI default: 1 USD = 500000 quota.
function quotaToUsd(quota: number): string {
  if (!quota || quota <= 0) return '$0.00'
  return `$${(quota / 500000).toFixed(4)}`
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'default' | 'success' | 'warn'
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-foreground'
  return (
    <div className='bg-card flex flex-col gap-1.5 rounded-xl border p-4'>
      <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
        <Icon className='h-3.5 w-3.5' />
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {sub ? (
        <div className='text-muted-foreground text-xs'>{sub}</div>
      ) : null}
    </div>
  )
}

export function SystemStatus() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['system-status'],
    queryFn: getSystemStatus,
    refetchInterval: 15000,
  })

  if (isLoading) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('System Status')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='flex h-64 items-center justify-center'>
            <div className='text-muted-foreground animate-pulse text-sm'>
              {t('Loading…')}
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  if (!data) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('System Status')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='text-muted-foreground p-8 text-center text-sm'>
            {t('No data')}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  const slotsTone =
    data.pool.slots_remaining > 0
      ? 'success'
      : ('warn' as const)
  const activeRatio =
    data.config.total_user_cap > 0
      ? Math.round(
          (data.pool.active_users / data.config.total_user_cap) * 100
        )
      : 0

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <span className='truncate'>{t('System Status')}</span>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              data.enabled
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-muted-foreground/20 bg-muted text-muted-foreground'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                data.enabled ? 'bg-emerald-500' : 'bg-muted-foreground'
              }`}
            />
            {data.enabled ? t('Active') : t('Disabled')}
          </span>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-6'>
        <p className='text-muted-foreground text-sm'>
          {data.enabled
            ? t('Dynamic quota is active — quota is reallocated hourly by demand.')
            : t('Dynamic quota is disabled — users use a static balance.')}
        </p>

      {/* Expected quota — the headline number */}
      <div className='from-primary/10 via-primary/5 to-transparent relative overflow-hidden rounded-2xl border bg-gradient-to-br p-6'>
        <div className='text-muted-foreground flex items-center gap-2 text-sm font-medium'>
          <TrendingUp className='h-4 w-4' />
          {t('Expected Quota per User')}
        </div>
        <div className='text-primary mt-2 text-4xl font-extrabold tabular-nums'>
          {quotaToUsd(data.pool.expected_per_user)}
          <span className='text-muted-foreground ml-2 text-base font-normal'>
            / {t('hour')}
          </span>
        </div>
        <p className='text-muted-foreground mt-2 max-w-lg text-xs'>
          {t(
            'Even-split baseline: pool ÷ active users. Actual per-user quota varies by 24h demand (heavy users get more, capped at the per-user cap).'
          )}
        </p>
      </div>

      {/* Pool stat cards */}
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <StatCard
          label={t('Active Users')}
          value={`${data.pool.active_users}`}
          sub={`${activeRatio}% ${t('of')} ${data.config.total_user_cap} ${t('cap')}`}
          icon={Users}
        />
        <StatCard
          label={t('Slots Remaining')}
          value={`${data.pool.slots_remaining}`}
          sub={
            data.pool.slots_remaining > 0
              ? t('Open for registration')
              : t('Waitlist active')
          }
          icon={Gauge}
          tone={slotsTone}
        />
        <StatCard
          label={t('Waitlist Size')}
          value={`${data.pool.waitlist_size}`}
          sub={t('Waiting in queue')}
          icon={Timer}
        />
        <StatCard
          label={t('At Cap')}
          value={`${data.pool.at_cap_users}`}
          sub={t('users maxed out')}
          icon={Activity}
          tone={data.pool.at_cap_users > 0 ? 'warn' : 'default'}
        />
      </div>

      {/* Config + last tick */}
      <div className='grid gap-4 lg:grid-cols-2'>
        <div className='bg-card rounded-xl border p-5'>
          <div className='text-muted-foreground mb-3 flex items-center gap-2 text-sm font-medium'>
            <Wallet className='h-4 w-4' />
            {t('Allocation Config')}
          </div>
          <dl className='grid grid-cols-2 gap-x-4 gap-y-3 text-sm'>
            <ConfigRow
              label={t('Hourly Pool')}
              value={`$${(data.config.pool_b_cents / 100).toFixed(2)}`}
            />
            <ConfigRow
              label={t('Per-User Floor')}
              value={`$${(data.config.floor_f_cents / 100).toFixed(2)}`}
            />
            <ConfigRow
              label={t('Per-User Cap')}
              value={`$${(data.config.cap_c_cents / 100).toFixed(2)}`}
            />
            <ConfigRow
              label={t('Lookback')}
              value={`${data.config.lookback_hours}h`}
            />
            <ConfigRow
              label={t('Inactivity Eviction')}
              value={`${data.config.inactivity_days}d`}
            />
            <ConfigRow
              label={t('Channel Cap')}
              value={`$${(data.config.channel_cap_cents / 100).toFixed(2)} / ${data.config.channel_cap_period === 'hourly' ? t('hr') : t('day')}`}
            />
          </dl>
        </div>

        <div className='bg-card rounded-xl border p-5'>
          <div className='text-muted-foreground mb-3 flex items-center gap-2 text-sm font-medium'>
            <Timer className='h-4 w-4' />
            {t('Last Reallocation')}
          </div>
          {data.tick.last_run_at ? (
            <dl className='grid grid-cols-2 gap-x-4 gap-y-3 text-sm'>
              <ConfigRow
                label={t('Last Run')}
                value={new Date(data.tick.last_run_at).toLocaleString()}
              />
              <ConfigRow
                label={t('Next Run')}
                value={new Date(data.tick.next_run_at).toLocaleString()}
              />
              <ConfigRow
                label={t('Evictions')}
                value={`${data.tick.evictions}`}
              />
              <ConfigRow
                label={t('Promotions')}
                value={`${data.tick.promotions}`}
              />
            </dl>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t('No tick has run yet. The first run happens at the next hour boundary.')}
            </p>
          )}
        </div>
      </div>

      {/* Channel pool status */}
      <div className='bg-card rounded-xl border'>
        <div className='border-b px-5 py-4'>
          <div className='flex items-center gap-2 text-sm font-medium'>
            <Radio className='text-muted-foreground h-4 w-4' />
            {t('Channel Pool')}
          </div>
        </div>
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='text-muted-foreground border-b text-left text-xs'>
                <th className='px-5 py-2.5 font-medium'>{t('Channel')}</th>
                <th className='px-5 py-2.5 font-medium'>{t('Today')}</th>
                <th className='px-5 py-2.5 font-medium'>{t('This Hour')}</th>
                <th className='px-5 py-2.5 font-medium'>{t('Requests')}</th>
                <th className='px-5 py-2.5 font-medium'>{t('Usage')}</th>
              </tr>
            </thead>
            <tbody>
              {data.channels && data.channels.length > 0 ? (
                data.channels.map((ch) => {
                  // Usage % against the active-period cap.
                  const periodSpent =
                    data.config.channel_cap_period === 'hourly'
                      ? ch.hourly_spent
                      : ch.daily_spent
                  const pct =
                    data.config.channel_cap_cents > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (periodSpent /
                              (data.config.channel_cap_cents * 5000)) *
                              100
                          )
                        )
                      : 0
                  return (
                    <tr key={ch.channel_id} className='border-b last:border-0'>
                      <td className='px-5 py-3 font-medium'>{ch.name}</td>
                      <td className='px-5 py-3 tabular-nums'>
                        {quotaToUsd(ch.daily_spent)}
                      </td>
                      <td className='px-5 py-3 tabular-nums'>
                        {quotaToUsd(ch.hourly_spent)}
                      </td>
                      <td className='px-5 py-3 tabular-nums'>
                        {ch.request_count}
                      </td>
                      <td className='px-5 py-3'>
                        <div className='flex items-center gap-2'>
                          <div className='bg-muted h-2 w-24 overflow-hidden rounded-full'>
                            <div
                              className={`h-full ${
                                pct > 80
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className='text-muted-foreground w-9 text-xs tabular-nums'>
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    className='text-muted-foreground px-5 py-8 text-center text-sm'
                  >
                    {t('No channels configured.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='font-medium tabular-nums'>{value}</dd>
    </div>
  )
}
