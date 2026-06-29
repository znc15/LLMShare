import type { ChangeEvent } from 'react'
import * as z from 'zod'
import type { Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
  SettingsFormGrid,
  SettingsFormGridItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

// 金额类字段在表单里以「美元」展示/编辑，但后端 Option 存的是「美分整数」
// （避免浮点精度问题）。提交保存时把美元 ×100 转成美分；显示默认值时由
// section-registry 直接除以 100，因此这里只需要保存方向的换算。
const CENTS_PER_USD = 100

// 美元 -> 美分（用于提交保存）。四舍五入到整数，避免浮点尾巴。
function usdToCents(usd: number | string): number {
  const n = typeof usd === 'number' ? usd : Number(usd)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * CENTS_PER_USD)
}

// 哪些 key 是金额字段（需要美元<->美分换算）。
const USD_FIELDS = new Set([
  'DynamicQuotaPoolB',
  'DynamicQuotaFloorF',
  'DynamicQuotaCapC',
  'ChannelBudgetCap',
  'MaxTopUp',
])

const dynamicQuotaSchema = z.object({
  DynamicQuotaEnabled: z.boolean(),
  // 金额字段：表单内单位为美元，允许小数（如 0.5 = $0.50）。
  DynamicQuotaPoolB: z.coerce.number().min(0),
  DynamicQuotaFloorF: z.coerce.number().min(0),
  DynamicQuotaCapC: z.coerce.number().min(0),
  // 非金额字段：小时 / 天 / 人数，保持整数语义。
  DynamicQuotaLookbackHours: z.coerce.number().min(1),
  InactivityThresholdDays: z.coerce.number().min(0),
  TotalUserCap: z.coerce.number().min(1),
  MagicLinkTTLHours: z.coerce.number().min(1),
  // Channel cap: amount (USD) + period (daily|hourly). 0 = no cap.
  ChannelBudgetCap: z.coerce.number().min(0),
  ChannelBudgetCapPeriod: z.enum(['daily', 'hourly']),
  // 单次充值上限（美元，0=不限）。
  MaxTopUp: z.coerce.number().min(0),
  // 快捷登录(OAuth)必须绑定邮箱。
  RequireEmailForOAuth: z.boolean(),
})

type DynamicQuotaFormValues = z.infer<typeof dynamicQuotaSchema>

type DynamicQuotaSectionProps = {
  defaultValues: DynamicQuotaFormValues
}

export function DynamicQuotaSection({
  defaultValues,
}: DynamicQuotaSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const handleNumberChange =
    (onChange: (value: number | string) => void) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(
        event.target.value === '' ? '' : event.currentTarget.valueAsNumber
      )
    }

  const { form, handleSubmit, isDirty, isSubmitting } =
    useSettingsForm<DynamicQuotaFormValues>({
      resolver: zodResolver(dynamicQuotaSchema) as Resolver<
        DynamicQuotaFormValues,
        unknown,
        DynamicQuotaFormValues
      >,
      defaultValues,
      onSubmit: async (_data, changedFields) => {
        for (const [key, value] of Object.entries(changedFields)) {
          // 金额字段：表单里是美元，提交时换算成美分整数存入 Option。
          const stored = USD_FIELDS.has(key)
            ? usdToCents(value as number | string)
            : (value as string | number | boolean)
          await updateOption.mutateAsync({ key, value: stored })
        }
      },
    })

  async function runTickNow() {
    try {
      const res = await api.post('/api/dynamic_quota/run_tick')
      if (res.data?.success) {
        toast.success(t('Reallocation tick scheduled'))
      } else {
        toast.error(res.data?.message || t('Failed to run tick'))
      }
    } catch (_e) {
      toast.error(t('Failed to run tick'))
    }
  }

  // Preset configurations. All amounts are in USD (the form's unit); they get
  // converted to cents on save. The non-amount knobs (lookback/inactivity/cap/
  // ttl) are shared across presets. Each preset is tuned to a pool size where
  // the proportional formula actually differentiates users.
  type Preset = {
    id: string
    name: string
    desc: string
    // amounts in USD
    poolB: number
    floorF: number
    capC: number
  }
  const PRESETS: Preset[] = [
    {
      id: 'personal',
      name: t('Personal / Small Team'),
      desc: t('Small pool (~10 users). Tight budgets, quota clearly scales with demand.'),
      poolB: 5,
      floorF: 0.05,
      capC: 1,
    },
    {
      id: 'standard',
      name: t('Standard Sharing'),
      desc: t('Balanced default (~30 users). Recommended for most shared gateways.'),
      poolB: 20,
      floorF: 0.1,
      capC: 3,
    },
    {
      id: 'generous',
      name: t('Generous / Public'),
      desc: t('Large pool (~50 users). Loose limits, prioritizes availability.'),
      poolB: 50,
      floorF: 0.5,
      capC: 5,
    },
    {
      id: 'free-trial',
      name: t('Free Trial'),
      desc: t('Tiny pool for evaluation. Heavy throttle so a few users can try it.'),
      poolB: 2,
      floorF: 0.02,
      capC: 0.3,
    },
    {
      id: 'team-pro',
      name: t('Team / Pro'),
      desc: t('Medium pool for a paying team (~20 users). Moderate limits, fair split.'),
      poolB: 15,
      floorF: 0.2,
      capC: 2,
    },
    {
      id: 'heavy-use',
      name: t('Heavy / Power Users'),
      desc: t('Higher caps for intensive users (~10). Lets power users push the cap.'),
      poolB: 30,
      floorF: 0.5,
      capC: 8,
    },
    {
      id: 'tight',
      name: t('Tight / Cost-Controlled'),
      desc: t('Minimal spend, everyone capped low. Good for expensive models.'),
      poolB: 10,
      floorF: 0.05,
      capC: 0.5,
    },
  ]

  async function applyPreset(presetId: string | null) {
    if (!presetId) return
    const p = PRESETS.find((x) => x.id === presetId)
    if (!p) return
    // Fill the form fields (in USD) so the user can review before saving.
    form.reset({
      ...form.getValues(),
      DynamicQuotaEnabled: true,
      DynamicQuotaPoolB: p.poolB,
      DynamicQuotaFloorF: p.floorF,
      DynamicQuotaCapC: p.capC,
    })
    toast.success(t('Preset applied — click Save to confirm'))
  }

  return (
    <SettingsSection title={t('Dynamic Quota')}>
      <FormNavigationGuard when={isDirty} />
      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit}>
          <SettingsPageFormActions
            onSave={handleSubmit}
            isSaving={updateOption.isPending || isSubmitting}
          />
          <FormDirtyIndicator isDirty={isDirty} />

          <SettingsFormGridItem span='full'>
            <FormField
              control={form.control}
              name='DynamicQuotaEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable Dynamic Quota')}</FormLabel>
                    <FormDescription>
                      {t(
                        'When enabled, each user gets an hourly quota recomputed from their 24h demand, instead of a static balance.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={updateOption.isPending}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
          </SettingsFormGridItem>

          {/* Preset selector: one-click fills the amount fields (USD). */}
          <SettingsFormGridItem span='full'>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4'>
              <div className='text-muted-foreground min-w-fit text-sm font-medium'>
                {t('Quick Presets')}
              </div>
              <Select onValueChange={applyPreset}>
                <SelectTrigger className='w-full sm:w-72'>
                  <SelectValue placeholder={t('Select a preset…')} />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className='flex flex-col'>
                        <span>{p.name}</span>
                        <span className='text-muted-foreground text-xs'>
                          {t('Pool ${{b}}/h · Floor ${{f}} · Cap ${{c}}', {
                            b: p.poolB,
                            f: p.floorF,
                            c: p.capC,
                          })}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className='text-muted-foreground text-xs'>
                {t('Applies amounts and enables Dynamic Quota — review then Save.')}
              </span>
            </div>
          </SettingsFormGridItem>

          {/* OAuth quick-login must bind email: keeps every user reachable by
              email (required for the waitlist/eviction email flow). */}
          <SettingsFormGridItem span='full'>
            <FormField
              control={form.control}
              name='RequireEmailForOAuth'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Require Email for Quick Login')}</FormLabel>
                    <FormDescription>
                      {t(
                        'OAuth/quick-login users (GitHub, WeChat, Telegram, Passkey, etc.) must bind a verified email before they can log in. Password login is unaffected.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={updateOption.isPending}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
          </SettingsFormGridItem>

          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='DynamicQuotaPoolB'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Hourly Budget Pool (USD)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Total USD split across all users each hour (B)')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='DynamicQuotaFloorF'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Per-User Floor (USD)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Guaranteed minimum per user per hour (F)')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='DynamicQuotaCapC'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Per-User Cap (USD)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Maximum any user can get per hour (C)')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='DynamicQuotaLookbackHours'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Demand Lookback (hours)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Window used to measure each user demand weight')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='InactivityThresholdDays'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Inactivity Eviction (days)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Hard-delete users inactive this long')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='TotalUserCap'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Total User Cap')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Max active users; beyond this, join the waitlist')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='MagicLinkTTLHours'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Magic Link TTL (hours)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('How long a promotion link stays valid')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ChannelBudgetCap'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Channel Budget Cap (USD)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Max spend per channel over the selected period (0 = no cap)')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ChannelBudgetCapPeriod'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Cap Period')}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='daily'>
                          {t('Daily')}
                        </SelectItem>
                        <SelectItem value='hourly'>
                          {t('Hourly')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>
                    {t('Window over which the channel cap is counted')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='MaxTopUp'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max Top-Up (USD)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Maximum amount a user may recharge in a single top-up (0 = unlimited)')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>
        </SettingsForm>

        <div className='mt-4 flex items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={runTickNow}
          >
            {t('Run reallocation now')}
          </Button>
          <span className='text-muted-foreground text-xs'>
            {t('Triggers an immediate evict → promote → reallocate cycle')}
          </span>
        </div>
      </Form>
    </SettingsSection>
  )
}
