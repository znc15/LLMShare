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
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { RichContent } from '@/components/rich-content'
import { isLikelyHtml } from '@/lib/content-format'
import { useAuthStore } from '@/stores/auth-store'
import { useStatus } from '@/hooks/use-status'
import { useTheme } from '@/context/theme-provider'

import { CTA, Features, Hero, HowItWorks, Stats } from './components'
import { useHomePageContent } from './hooks'

export function Home() {
  const { t } = useTranslation()
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user
  const { content, isLoaded, isUrl } = useHomePageContent()
  const { resolvedTheme } = useTheme()
  const { status } = useStatus()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Cache-bust the iframe src when the build version changes, so a new
  // /home.html (embedded in a fresh binary) is never served stale by the
  // browser's Cache-Control:max-age=604800. Only applied to same-origin
  // root-relative URLs (e.g. "/home.html"); external URLs are left intact.
  const iframeSrc =
    content && isUrl && content.startsWith('/')
      ? `${content}${content.includes('?') ? '&' : '?'}v=${encodeURIComponent(status?.version ?? '')}`
      : content

  // LLMShare: mirror the NewAPI theme into the home-page iframe (so the custom
  // landing page follows the parent theme). Only same-origin iframes honor it.
  useEffect(() => {
    const send = () =>
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'llmshare-theme', theme: resolvedTheme },
        window.location.origin
      )
    send()
    // Respond to the iframe's request for the theme on load.
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (e.data?.type === 'llmshare-theme-request') send()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [resolvedTheme, content, isUrl])

  if (!isLoaded) {
    return (
      <PublicLayout showMainContainer={false}>
        <main className='flex min-h-screen items-center justify-center'>
          <div className='text-muted-foreground'>{t('Loading...')}</div>
        </main>
      </PublicLayout>
    )
  }

  if (content) {
    if (isUrl) {
      return (
        <PublicLayout showMainContainer={false}>
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className='h-screen w-full border-none'
            title={t('Custom Home Page')}
            // allow-same-origin so the same-origin /home.html can receive
            // postMessage theme sync from the parent.
            sandbox='allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin'
          />
        </PublicLayout>
      )
    }

    return (
      <PublicLayout>
        <div className='mx-auto max-w-6xl px-4 py-8'>
          <RichContent
            mode={isLikelyHtml(content) ? 'html' : 'markdown'}
            content={content}
            className='custom-home-content'
          />
        </div>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <Hero isAuthenticated={isAuthenticated} />
      <Stats />
      <Features />
      <HowItWorks />
      <CTA isAuthenticated={isAuthenticated} />
      <Footer />
    </PublicLayout>
  )
}
