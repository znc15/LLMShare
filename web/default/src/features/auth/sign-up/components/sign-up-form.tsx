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
import { useEffect, useMemo, useState } from 'react'
import type { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useStatus } from '@/hooks/use-status'
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
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/dialog'
import { PasswordInput } from '@/components/password-input'
import { Turnstile } from '@/components/turnstile'
import { register, wechatLoginByCode } from '@/features/auth/api'
import { LegalConsent } from '@/features/auth/components/legal-consent'
import { OAuthProviders } from '@/features/auth/components/oauth-providers'
import { registerFormSchema } from '@/features/auth/constants'
import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'
import { useEmailVerification } from '@/features/auth/hooks/use-email-verification'
import { useTurnstile } from '@/features/auth/hooks/use-turnstile'
import {
  getAffiliateCode,
  saveAffiliateCode,
} from '@/features/auth/lib/storage'

export function SignUpForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [agreedToLegal, setAgreedToLegal] = useState(false)
  const [wechatCode, setWeChatCode] = useState('')
  const [isWeChatDialogOpen, setIsWeChatDialogOpen] = useState(false)
  const [isWeChatSubmitting, setIsWeChatSubmitting] = useState(false)
  const legalConsentErrorMessage = t('Please agree to the legal terms first')

  const { status } = useStatus()
  const {
    isTurnstileEnabled,
    turnstileSiteKey,
    turnstileToken,
    setTurnstileToken,
    validateTurnstile,
  } = useTurnstile()
  const { redirectToLogin, handleLoginSuccess } = useAuthRedirect()
  const {
    isSending: isSendingCode,
    secondsLeft,
    isActive,
    sendCode,
  } = useEmailVerification({
    turnstileToken,
    validateTurnstile,
  })

  const form = useForm<z.infer<typeof registerFormSchema>>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      invite_code: '',
    },
  })

  const emailValue = form.watch('email')
  const emailVerificationRequired = !!status?.email_verification
  const passwordRegisterEnabled = !!status?.password_register_enabled
  // LLMShare: when the invitation-code gate is on, both password and OAuth
  // sign-up require a valid code. The field is shown conditionally and
  // validated at submit time (and before clicking any OAuth button).
  const inviteCodeRequired = !!status?.invite_code_register_enabled
  const inviteCode = form.watch('invite_code') ?? ''
  const hasUserAgreement = Boolean(status?.user_agreement_enabled)
  const hasPrivacyPolicy = Boolean(status?.privacy_policy_enabled)
  const requiresLegalConsent = hasUserAgreement || hasPrivacyPolicy
  const oauthRegisterEnabled =
    status?.oauth_register_enabled ??
    status?.data?.oauth_register_enabled ??
    true
  const hasWeChatLogin = Boolean(status?.wechat_login)
  const turnstileReady = !isTurnstileEnabled || Boolean(turnstileToken)

  const wechatQrCodeUrl = useMemo(() => {
    return (
      status?.wechat_qrcode ||
      status?.wechat_qr_code ||
      status?.wechat_qrcode_image_url ||
      status?.wechat_qr_code_image_url ||
      status?.wechat_account_qrcode_image_url ||
      status?.WeChatAccountQRCodeImageURL ||
      status?.data?.wechat_qrcode ||
      status?.data?.WeChatAccountQRCodeImageURL ||
      ''
    )
  }, [status])

  useEffect(() => {
    if (requiresLegalConsent) {
      setAgreedToLegal(false)
    } else {
      setAgreedToLegal(true)
    }
  }, [requiresLegalConsent])

  useEffect(() => {
    const aff = new URLSearchParams(window.location.search).get('aff')?.trim()
    if (aff) {
      saveAffiliateCode(aff)
    }
  }, [])

  async function onSubmit(data: z.infer<typeof registerFormSchema>) {
    // Defensive: the password-registration form is hidden (and the submit
    // button not rendered) when PasswordRegisterEnabled is off, but the
    // <form> element still wraps the OAuth/invite-code area, so a stray
    // Enter key could reach this handler. Bail out instead of attempting a
    // registration the backend would reject.
    if (!passwordRegisterEnabled) return

    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }

    // Validate email verification if required
    if (emailVerificationRequired) {
      if (!data.email) {
        toast.error(t('Please enter your email'))
        return
      }
      if (!verificationCode) {
        toast.error(t('Please enter the verification code'))
        return
      }
    }

    // LLMShare: invitation-code gate (password registration path).
    if (inviteCodeRequired && !data.invite_code?.trim()) {
      toast.error(t('An invitation code is required to register'))
      return
    }

    if (!validateTurnstile()) return

    setIsLoading(true)
    try {
      const res = await register({
        username: data.username,
        password: data.password,
        email: data.email || undefined,
        verification_code: verificationCode || undefined,
        aff_code: getAffiliateCode(),
        invite_code: data.invite_code || undefined,
        turnstile: turnstileToken,
      })

      if (res?.success) {
        toast.success(t('Account created! Please sign in'))
        redirectToLogin()
      } else {
        toast.error(res?.message || t('Failed to create account'))
      }
    } catch (_error) {
      // Errors are handled by global interceptor
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSendVerificationCode() {
    await sendCode(emailValue || '')
  }

  const handleOpenWeChatDialog = () => {
    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }

    setIsWeChatDialogOpen(true)
  }

  const handleWeChatDialogChange = (open: boolean) => {
    setIsWeChatDialogOpen(open)
    if (!open) {
      setWeChatCode('')
      setIsWeChatSubmitting(false)
    }
  }

  async function handleWeChatLogin() {
    if (!wechatCode.trim()) {
      toast.error(t('Please enter the verification code'))
      return
    }

    setIsWeChatSubmitting(true)
    try {
      const res = await wechatLoginByCode(wechatCode)
      if (res?.success) {
        await handleLoginSuccess(res.data as { id?: number } | null)
        toast.success(t('Signed in via WeChat'))
        handleWeChatDialogChange(false)
      } else {
        toast.error(res?.message || t('Login failed'))
      }
    } catch (_error) {
      toast.error(t('Login failed'))
    } finally {
      setIsWeChatSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-4', className)}
        {...props}
      >
        {/* LLMShare: invitation code field — shown when the gate is on. Shared
            by both password and OAuth sign-up, so it renders outside the
            password-only block below. */}
        {inviteCodeRequired && (
          <FormField
            control={form.control}
            name='invite_code'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Invitation Code')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('Enter your invitation code')}
                    autoComplete='off'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Password-registration fields. Hidden entirely when the operator
            has disabled password registration (PasswordRegisterEnabled=false);
            in that case the page shows only the invitation code + OAuth
            buttons, and password submit is never reachable. */}
        {passwordRegisterEnabled && (
          <>
            {/* Username Field */}
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

            {/* Password Field */}
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

        {/* Confirm Password Field */}
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Confirm password')}</FormLabel>
              <FormControl>
                <PasswordInput placeholder={t('Confirm password')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Email Verification Section */}
        {emailVerificationRequired && (
          <>
            {/* Email Field */}
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Email (required for verification)')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('name@example.com')}
                      type='email'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Verification Code Field */}
            <div className='flex items-end gap-2'>
              <div className='flex-1'>
                <Input
                  placeholder={t('Verification code')}
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                />
              </div>
              <Button
                variant='outline'
                type='button'
                disabled={
                  isLoading ||
                  isSendingCode ||
                  isActive ||
                  !emailValue ||
                  !turnstileReady
                }
                onClick={handleSendVerificationCode}
              >
                {isActive ? (
                  t('Resend ({{seconds}}s)', { seconds: secondsLeft })
                ) : isSendingCode ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  t('Send code')
                )}
              </Button>
            </div>
          </>
        )}
        </>
        )}

        {/* Turnstile */}
        {isTurnstileEnabled && (
          <div className='mt-2'>
            <Turnstile
              siteKey={turnstileSiteKey}
              onVerify={setTurnstileToken}
            />
          </div>
        )}

        <LegalConsent
          status={status}
          checked={agreedToLegal}
          onCheckedChange={setAgreedToLegal}
          className='mt-1'
        />

        {/* Submit Button — password registration only. */}
        {passwordRegisterEnabled && (
          <Button
            type='submit'
            className='mt-2 w-full justify-center gap-2'
            disabled={
              isLoading ||
              (requiresLegalConsent && !agreedToLegal) ||
              !turnstileReady
            }
          >
            {isLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
            {t('Create account')}
          </Button>
        )}

        {oauthRegisterEnabled && (
          <OAuthProviders
            status={status}
            disabled={
              isLoading ||
              (requiresLegalConsent && !agreedToLegal) ||
              (inviteCodeRequired && !inviteCode.trim())
            }
            onWeChatLogin={hasWeChatLogin ? handleOpenWeChatDialog : undefined}
            isWeChatLoading={isWeChatSubmitting}
            inviteCode={inviteCodeRequired ? inviteCode.trim() : undefined}
            className='pt-2'
          />
        )}
      </form>

      {hasWeChatLogin && (
        <Dialog
          open={isWeChatDialogOpen}
          onOpenChange={handleWeChatDialogChange}
          title={t('WeChat sign in')}
          description={t(
            'Scan the QR code to follow the official account and reply with “验证码” to receive your verification code.'
          )}
          contentClassName='max-w-sm'
          headerClassName='text-left'
          contentHeight='auto'
          bodyClassName='space-y-4'
          footer={
            <>
              <Button
                type='button'
                variant='outline'
                onClick={() => handleWeChatDialogChange(false)}
                disabled={isWeChatSubmitting}
              >
                {t('Cancel')}
              </Button>
              <Button
                type='button'
                onClick={handleWeChatLogin}
                disabled={
                  isWeChatSubmitting ||
                  !wechatCode.trim() ||
                  (requiresLegalConsent && !agreedToLegal)
                }
                className='gap-2'
              >
                {isWeChatSubmitting ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : null}
                {t('Confirm')}
              </Button>
            </>
          }
        >
          {wechatQrCodeUrl ? (
            <div className='flex justify-center'>
              <img
                src={wechatQrCodeUrl}
                alt={t('WeChat login QR code')}
                className='h-40 w-40 rounded-md border object-contain'
              />
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t('QR code is not configured. Please contact support.')}
            </p>
          )}
          <div className='grid gap-2'>
            <Label htmlFor='wechat-code'>{t('Verification code')}</Label>
            <Input
              id='wechat-code'
              placeholder={t('Enter the verification code')}
              value={wechatCode}
              onChange={(event) => setWeChatCode(event.target.value)}
              autoComplete='one-time-code'
            />
          </div>
        </Dialog>
      )}
    </Form>
  )
}
