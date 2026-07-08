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
import * as z from 'zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Loader2, Copy, Check, Trash2, Plus, Download } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormLabel,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'

const registrationSchema = z.object({
  InviteCodeRegisterEnabled: z.boolean(),
  // USD amount (form shows dollars; backend stores cents).
  MaxTopUp: z.number().min(0),
})

type RegistrationFormValues = z.infer<typeof registrationSchema>

type RegistrationSectionProps = {
  defaultValues: RegistrationFormValues
}

// Minimal shape returned by GET /api/invitation_code/. The list is paginated
// server-side; we only render what we need for the inline admin panel.
interface InvitationCode {
  id: number
  code: string
  name: string
  status: number // 1 = unused, 2 = used
  created_user_id: number
  used_user_id: number
  created_time: number
  used_time: number
  expired_time: number
}

// The list endpoint returns a paginated payload (ApiSuccess(pageInfo)), where
// pageInfo is { page, page_size, total, items: InvitationCode[] }. The generate
// endpoint returns the freshly-created rows directly as data. These two shapes
// are kept separate so each call site reads the right field.
interface InvitationCodesPageResponse {
  success: boolean
  data: {
    items?: InvitationCode[]
    total?: number
    [key: string]: unknown
  }
}

interface InvitationCodesGenerateResponse {
  success: boolean
  data?: InvitationCode[]
  message?: string
}

// invitation-code inline management (generate / list / copy / delete). Kept in
// the same section as the gate switch so an operator can flip the gate on and
// mint codes without leaving the page.
function InvitationCodeManager() {
  const { t } = useTranslation()
  const [codes, setCodes] = useState<InvitationCode[]>([])
  const [loading, setLoading] = useState(false)
  const [count, setCount] = useState(1)
  const [name, setName] = useState('')
  const [expireDays, setExpireDays] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const fetchCodes = async () => {
    setLoading(true)
    try {
      const res = await api.get<InvitationCodesPageResponse>(
        '/api/invitation_code/?p=1&page_size=50'
      )
      // Backend wraps the list in a pageInfo object ({items, total, ...}),
      // so read data.items — never data itself (it is not an array).
      const items = res.data?.data?.items
      if (Array.isArray(items)) {
        setCodes(items)
      }
    } catch {
      // ignore — panel is best-effort
    } finally {
      setLoading(false)
    }
  }

  // Export ALL codes as CSV. The backend streams the full set (no page_size
  // cap), so this is the way to pull more than the 50 rows shown inline. Using
  // a token-bearing request and converting the blob lets the browser trigger a
  // real download with the server's filename.
  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await api.get('/api/invitation_code/export', {
        responseType: 'blob',
      })
      const disposition = res.headers['content-disposition'] || ''
      const match = disposition.match(/filename="?([^"]+)"?/i)
      const fileName =
        match?.[1] || `invitation_codes_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: 'text/csv;charset=utf-8;' })
      )
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      toast.success(t('Exported'))
    } catch {
      toast.error(t('Failed to export'))
    } finally {
      setExporting(false)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await api.post<InvitationCodesGenerateResponse>(
        '/api/invitation_code/',
        {
          count,
          name,
          expire_days: expireDays,
        }
      )
      if (res.data?.success) {
        const created = Array.isArray(res.data.data) ? res.data.data : []
        toast.success(
          t('Generated {{n}} invitation code(s)', {
            n: created.length || count,
          })
        )
        setName('')
        // Prepend the freshly-created codes and re-fetch to reconcile order.
        // fetchCodes reads data.items (paginated payload) — safe now.
        if (created.length > 0) {
          setCodes((prev) => [...created, ...prev])
        }
        await fetchCodes()
      } else {
        toast.error(res.data?.message ?? t('Failed to generate'))
      }
    } catch (err) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? t('Failed to generate')
      )
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      const res = await api.delete(`/api/invitation_code/${id}`)
      if (res.data?.success) {
        toast.success(t('Deleted'))
        await fetchCodes()
      }
    } catch {
      toast.error(t('Failed to delete'))
    }
  }

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    toast.success(t('Copied'))
    setTimeout(() => setCopiedCode(null), 1500)
  }

  // Lazy-load on first expand: fetch when the list is empty and not loading.
  const ensureLoaded = () => {
    if (!loading && codes.length === 0) fetchCodes()
  }

  return (
    <div className='bg-card mt-6 rounded-xl border p-5'>
      <div className='mb-4 flex items-center justify-between'>
        <h3 className='text-sm font-medium'>{t('Invitation Codes')}</h3>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={fetchCodes}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              t('Refresh')
            )}
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <Download className='h-4 w-4' />
            )}
            {t('Export CSV')}
          </Button>
        </div>
      </div>

      {/* Generate row */}
      <div className='grid grid-cols-1 gap-2 sm:grid-cols-[80px_1fr_100px_auto]'>
        <Input
          type='number'
          min={1}
          max={1000}
          value={count}
          onChange={(e) => setCount(Number(e.target.value) || 1)}
          placeholder={t('Count')}
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('Label (optional)')}
        />
        <Input
          type='number'
          min={0}
          value={expireDays}
          onChange={(e) => setExpireDays(Number(e.target.value) || 0)}
          placeholder={t('Expire days (0=never)')}
        />
        <Button onClick={handleGenerate} disabled={generating}>
          {generating ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Plus className='h-4 w-4' />
          )}
          {t('Generate')}
        </Button>
      </div>

      {/* List */}
      <div
        className='mt-4 max-h-72 overflow-y-auto'
        onMouseEnter={ensureLoaded}
      >
        {codes.length === 0 ? (
          <p className='text-muted-foreground py-6 text-center text-sm'>
            {t('No invitation codes. Generate some above or hover to load.')}
          </p>
        ) : (
          <ul className='space-y-1'>
            {codes.map((c) => {
              const used = c.status === 2
              const expired =
                c.expired_time !== 0 && c.expired_time * 1000 < Date.now()
              return (
                <li
                  key={c.id}
                  className='flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm'
                >
                  <code className='font-mono font-medium'>{c.code}</code>
                  <div className='text-muted-foreground flex items-center gap-2'>
                    {c.name ? <span className='truncate'>{c.name}</span> : null}
                    <span
                      className={
                        used
                          ? 'text-amber-600 dark:text-amber-400'
                          : expired
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                      }
                    >
                      {used
                        ? t('used')
                        : expired
                          ? t('expired')
                          : t('unused')}
                    </span>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 w-7 p-0'
                      onClick={() => handleCopy(c.code)}
                    >
                      {copiedCode === c.code ? (
                        <Check className='h-3.5 w-3.5' />
                      ) : (
                        <Copy className='h-3.5 w-3.5' />
                      )}
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-muted-foreground hover:text-destructive h-7 w-7 p-0'
                      onClick={() => handleDelete(c.id)}
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export function RegistrationSection({
  defaultValues,
}: RegistrationSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm({
    resolver: zodResolver(registrationSchema),
    defaultValues,
  })

  useResetForm(form, defaultValues)

  const onSubmit = async (data: RegistrationFormValues) => {
    const updates = Object.entries(data).filter(
      ([key, value]) =>
        value !== defaultValues[key as keyof RegistrationFormValues]
    )
    for (const [key, value] of updates) {
      if (key === 'MaxTopUp') {
        // form is dollars, backend stores cents
        await updateOption.mutateAsync({
          key,
          value: Math.round((value as number) * 100),
        })
      } else {
        await updateOption.mutateAsync({ key, value })
      }
    }
  }

  return (
    <SettingsSection title={t('Registration')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='InviteCodeRegisterEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Require Invitation Code')}</FormLabel>
                  <FormDescription>
                    {t(
                      'When on, new users must supply a valid one-time invitation code to register (password and OAuth).'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='MaxTopUp'
            render={({ field }) => (
              <div className='flex flex-col gap-2'>
                <FormLabel>{t('Max Single Top-Up (USD)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    step='0.01'
                    value={field.value}
                    onChange={(e) =>
                      field.onChange(Number(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t('0 = unlimited. Caps how much a user can recharge at once.')}
                </FormDescription>
              </div>
            )}
          />
        </SettingsForm>
      </Form>

      <InvitationCodeManager />
    </SettingsSection>
  )
}
