import { useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AuthLayout } from '../auth-layout'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { joinWaitlist, getWaitlistStatus } from './api'

const waitlistSchema = z.object({
  email: z.string().email(),
})

// Map provider slugs (as used in routes /api/oauth/:provider) to display names
// for the "via Discord" hint shown when a person is routed here from a full
// OAuth sign-up.
const providerDisplayName: Record<string, string> = {
  github: 'GitHub',
  discord: 'Discord',
  oidc: 'OIDC',
  linuxdo: 'LinuxDO',
  wechat: 'WeChat',
  telegram: 'Telegram',
}

export function Waitlist() {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [position, setPosition] = useState<number | null>(null)
  // provider/provider_user_id arrive via /waitlist?provider=discord&provider_user_id=...
  // when routed here from a full OAuth sign-up. They are forwarded to the backend
  // so the OAuth identity can be re-bound to the account at activation.
  const search = useSearch({ from: '/(auth)/waitlist' })
  const provider = search.provider || ''
  const providerUserId = search.provider_user_id || ''
  const providerLabel = providerDisplayName[provider] || provider

  const form = useForm<z.infer<typeof waitlistSchema>>({
    resolver: zodResolver(waitlistSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(data: z.infer<typeof waitlistSchema>) {
    setIsLoading(true)
    try {
      const res = await joinWaitlist(
        data.email,
        provider || undefined,
        providerUserId || undefined,
      )
      if (res?.success) {
        setPosition(res.position ?? null)
        toast.success(
          res.message || t('You have joined the waitlist')
        )
      } else {
        toast.error(res?.message || t('Failed to join waitlist'))
      }
    } catch (_error) {
      // handled by global interceptor
    } finally {
      setIsLoading(false)
    }
  }

  async function onCheckStatus() {
    const email = form.getValues('email')
    if (!email) {
      toast.error(t('Please enter your email'))
      return
    }
    setIsLoading(true)
    try {
      const res = await getWaitlistStatus(email)
      if (res?.success) {
        setPosition(res.position)
        toast.success(t('Position #{{n}}', { n: res.position }))
      } else {
        toast.error(res?.message || t('Not found'))
      }
    } catch (_error) {
      // handled by global interceptor
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className='w-full space-y-8'>
        <div className='space-y-2'>
          <h2 className='text-center text-2xl font-semibold tracking-tight sm:text-left'>
            {t('Join the waitlist')}
          </h2>
          <p className='text-muted-foreground text-left text-sm sm:text-base'>
            {t(
              'Registration is currently full. Enter your email to join the waitlist — you will get a magic link when a slot opens.'
            )}
          </p>
        </div>

        {position !== null && (
          <div className='bg-primary/5 border-primary/20 rounded-lg border p-4 text-center'>
            <p className='text-muted-foreground text-sm'>{t('Your position')}</p>
            <p className='text-primary text-3xl font-bold'>#{position}</p>
          </div>
        )}

        {provider && (
          <div className='bg-muted text-muted-foreground rounded-lg border p-3 text-center text-sm'>
            {t('Your {{provider}} account will be linked after activation.', {
              provider: providerLabel,
            })}
          </div>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='grid gap-4'
          >
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Email')}</FormLabel>
                  <FormControl>
                    <Input
                      type='email'
                      placeholder='name@example.com'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type='submit'
              className='w-full justify-center gap-2'
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
              {t('Join waitlist')}
            </Button>
          </form>
        </Form>

        <Button
          type='button'
          variant='outline'
          className='w-full justify-center'
          disabled={isLoading}
          onClick={onCheckStatus}
        >
          {t('Check my position')}
        </Button>

        <p className='text-muted-foreground text-center text-sm'>
          {t('Already have an account?')}{' '}
          <Link
            to='/sign-in'
            className='hover:text-primary font-medium underline underline-offset-4'
          >
            {t('Sign in')}
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
