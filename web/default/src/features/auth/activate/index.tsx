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
import { PasswordInput } from '@/components/password-input'
import { activateByMagicLink } from './api'

const activateSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(8).max(20),
})

export function Activate() {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [done, setDone] = useState(false)
  // The magic token arrives as ?token=... from the promotion email link.
  const search = useSearch({ strict: false }) as { token?: string }
  const token = search.token || ''

  const form = useForm<z.infer<typeof activateSchema>>({
    resolver: zodResolver(activateSchema),
    defaultValues: { username: '', password: '' },
  })

  async function onSubmit(data: z.infer<typeof activateSchema>) {
    if (!token) {
      toast.error(t('Invalid or expired activation link'))
      return
    }
    setIsLoading(true)
    try {
      const res = await activateByMagicLink({
        token,
        username: data.username,
        password: data.password,
      })
      if (res?.success) {
        setDone(true)
        toast.success(res.message || t('Account activated! Please sign in'))
      } else {
        toast.error(res?.message || t('Activation failed'))
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
            {t('Activate your account')}
          </h2>
          <p className='text-muted-foreground text-left text-sm sm:text-base'>
            {t(
              'Your waitlist slot is ready. Choose a username and password to finish activating your account.'
            )}
          </p>
        </div>

        {done ? (
          <div className='space-y-4'>
            <div className='bg-primary/5 border-primary/20 rounded-lg border p-4 text-center'>
              <p className='text-foreground font-medium'>
                {t('Account activated successfully!')}
              </p>
            </div>
            <Link to='/sign-in' className='block'>
              <Button className='w-full justify-center'>
                {t('Sign in')}
              </Button>
            </Link>
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className='grid gap-4'
            >
              <FormField
                control={form.control}
                name='username'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Username')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('Enter your username')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='password'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Password')}</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder={t('Enter password (8-20 characters)')}
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
                disabled={isLoading || !token}
              >
                {isLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
                {t('Activate account')}
              </Button>
            </form>
          </Form>
        )}

        <p className='text-muted-foreground text-center text-sm'>
          <Link
            to='/waitlist'
            className='hover:text-primary font-medium underline underline-offset-4'
          >
            {t('Back to waitlist')}
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
