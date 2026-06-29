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
import { useRef, useState } from 'react'
import {
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCcwIcon,
  UploadIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatTimestampToDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/ui/markdown'
import { Dialog } from '@/components/dialog'
import { SettingsSection } from '../components/settings-section'

type ReleaseInfo = {
  tag_name: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
}

type UpdateCheckerSectionProps = {
  currentVersion?: string | null
}

export function UpdateCheckerSection({
  currentVersion,
}: UpdateCheckerSectionProps) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [release, setRelease] = useState<ReleaseInfo | null>(null)
  // LLMShare: settings import/export state.
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<string>('')

  const version = currentVersion || t('Unknown')

  const handleImportFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const res = await api.post('/api/option/import', text, {
        headers: { 'Content-Type': 'application/json' },
      })
      const json = res.data
      if (json.success) {
        const applied = json.data?.applied ?? 0
        const skipped = json.data?.skipped?.length ?? 0
        setImportResult(
          t('Imported: {{applied}} applied, {{skipped}} skipped', {
            applied,
            skipped,
          })
        )
      } else {
        setImportResult(json.message || t('Import failed'))
      }
    } catch (e) {
      setImportResult(t('Import failed'))
    } finally {
      event.target.value = ''
    }
  }

  const handleCheckUpdates = async () => {
    setChecking(true)
    try {
      const response = await fetch(
        'https://api.github.com/repos/znc15/newapiapi/releases/latest',
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'new-api-dashboard',
          },
        }
      )

      if (!response.ok) {
        throw new Error(t('Failed to contact GitHub releases API'))
      }

      const data = (await response.json()) as ReleaseInfo
      if (!data?.tag_name) {
        throw new Error(t('Unexpected release payload'))
      }

      if (currentVersion && data.tag_name === currentVersion) {
        toast.success(
          t('You are running the latest version ({{version}}).', {
            version: data.tag_name,
          })
        )
        return
      }

      setRelease(data)
      setDialogOpen(true)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('Failed to check for updates')
      toast.error(message)
    } finally {
      setChecking(false)
    }
  }

  const goToRelease = () => {
    if (release?.html_url) {
      window.open(release.html_url, '_blank', 'noopener,noreferrer')
    }
  }

  // LLMShare: download the settings JSON via the api client (it injects the
  // New-Api-User header that AdminAuth requires), then trigger a file save.
  const handleExport = async () => {
    try {
      const res = await api.get('/api/option/export', { responseType: 'blob' })
      // axios puts headers under res.headers; for browsers it's res.headers too.
      const cd =
        (res.headers as Record<string, string>)?.['content-disposition'] || ''
      const fname = cd.match(/filename="?([^"]+)"?/)?.[1] || 'newapi-options.json'
      const url = window.URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fname
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      toast.success(t('Settings exported'))
    } catch (e) {
      toast.error(t('Export failed'))
    }
  }

  return (
    <>
      <SettingsSection title={t('System maintenance')}>
        <div className='space-y-6'>
          <div className='rounded-lg border p-4'>
            <div className='text-muted-foreground text-sm'>
              {t('Current version')}
            </div>
            <div className='text-lg font-semibold'>{version}</div>
          </div>

          <Button onClick={handleCheckUpdates} disabled={checking}>
            {checking ? (
              t('Checking updates...')
            ) : (
              <>
                <RefreshCcwIcon className='me-2 h-4 w-4' />
                {t('Check for updates')}
              </>
            )}
          </Button>
        </div>
      </SettingsSection>

      {/* LLMShare: export / import all settings (config backup & transfer). */}
      <SettingsSection title={t('Settings Backup')}>
        <div className='space-y-4'>
          <div className='rounded-lg border p-4'>
            <div className='text-muted-foreground text-sm'>
              {t('Export all configuration options as a JSON file for backup or migration.')}
            </div>
          </div>
          <div className='flex flex-wrap items-center gap-3'>
            <Button onClick={handleExport}>
              <DownloadIcon className='me-2 h-4 w-4' />
              {t('Export Settings')}
            </Button>
            <Button
              variant='outline'
              onClick={() => importInputRef.current?.click()}
            >
              <UploadIcon className='me-2 h-4 w-4' />
              {t('Import Settings')}
            </Button>
            <input
              ref={importInputRef}
              type='file'
              accept='application/json,.json'
              className='hidden'
              onChange={handleImportFile}
            />
          </div>
          {importResult && (
            <div className='text-muted-foreground rounded-lg border p-3 text-sm'>
              {importResult}
            </div>
          )}
        </div>
      </SettingsSection>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          release?.tag_name
            ? t('New version available: {{version}}', {
                version: release.tag_name,
              })
            : t('Release details')
        }
        description={
          release?.published_at
            ? `${t('Published')} ${formatTimestampToDate(
                new Date(release.published_at).getTime(),
                'milliseconds'
              )}`
            : undefined
        }
        contentClassName='max-h-[80vh] overflow-y-auto'
        contentHeight='auto'
        bodyClassName='space-y-4'
        footer={
          <>
            <Button
              type='button'
              variant='secondary'
              onClick={() => setDialogOpen(false)}
            >
              {t('Close')}
            </Button>
            {release?.html_url && (
              <Button type='button' onClick={goToRelease}>
                <ExternalLinkIcon className='me-2 h-4 w-4' />
                {t('Open release')}
              </Button>
            )}
          </>
        }
      >
        <div className='space-y-4'>
          {release?.body ? (
            <Markdown>{release.body}</Markdown>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t('No release notes provided.')}
            </p>
          )}
        </div>
      </Dialog>
    </>
  )
}
