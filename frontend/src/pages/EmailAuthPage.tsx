import { Alert, Button, Divider, Link, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { sendMagicLink, verifyMagicLink } from '../api/auth'
import { getPublicBranding } from '../api/guest'
import { discoverSso } from '../api/sso'
import { AuthCard } from '../components/AuthCard'
import { CodeInput } from '../components/CodeInput'
import { useAuthCompletion } from './useAuthCompletion'

// Sign-in: enter an email, then either click the emailed link (handled by
// VerifyPage) or type the 6-digit code here.
export function EmailAuthPage() {
  const [phase, setPhase] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [params0] = useSearchParams()
  const [error, setError] = useState<string | null>(params0.get('sso_error'))
  const [checkingSso, setCheckingSso] = useState(false)
  const completeAuth = useAuthCompletion()

  // A customer arriving from a workspace's branded submit form or portal link
  // carries ?workspace=slug, which scopes the magic link and brands this screen.
  const [params] = useSearchParams()
  const scopedSlug = params.get('workspace') ?? undefined
  const { data: scopedWorkspace } = useQuery({
    queryKey: ['branding', scopedSlug],
    queryFn: () => getPublicBranding(scopedSlug!),
    enabled: !!scopedSlug,
    retry: false,
    staleTime: 60_000,
  })

  // If this installation has SSO configured, hand off to the IdP; otherwise fall
  // back to the magic link. Branded per-workspace logins are customer-facing and
  // stay on the magic link.
  const beginLogin = async () => {
    if (!email.includes('@')) return
    setError(null)
    if (!scopedSlug) {
      setCheckingSso(true)
      try {
        const discovery = await discoverSso()
        if (discovery?.startUrl) {
          window.location.href = discovery.startUrl
          return
        }
      } catch {
        // discovery failure is non-fatal — fall back to magic link
      } finally {
        setCheckingSso(false)
      }
    }
    send.mutate()
  }

  const send = useMutation({
    mutationFn: () => sendMagicLink(email, scopedSlug),
    onSuccess: () => {
      setError(null)
      setCode('')
      setPhase('code')
    },
    onError: (e: Error) => setError(e.message),
  })

  const verify = useMutation({
    mutationFn: () => verifyMagicLink({ email, code, workspaceSlug: scopedSlug }),
    onSuccess: (res) => completeAuth(res.user),
    onError: (e: Error) => setError(e.message),
  })

  const brand = scopedWorkspace
    ? { name: scopedWorkspace.workspaceName, logoUrl: scopedWorkspace.logoUrl, color: scopedWorkspace.primaryColor }
    : null
  const brandBtn = brand
    ? { bgcolor: brand.color, '&:hover': { bgcolor: brand.color, filter: 'brightness(0.92)' } }
    : undefined

  if (phase === 'code') {
    return (
      <AuthCard
        title="Check your email 📬"
        brand={brand}
        subtitle={
          <>
            We sent a sign-in link and a 6-digit code to <b>{email}</b>.
            <br />
            The link expires in 10 minutes.
          </>
        }
      >
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: '#334155', mb: 1 }}>
          Or enter the code from the email
        </Typography>
        <CodeInput value={code} onChange={setCode} disabled={verify.isPending} />
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        <Button
          fullWidth
          size="large"
          variant="contained"
          sx={{ mt: 3, ...brandBtn }}
          disabled={code.length !== 6 || verify.isPending}
          onClick={() => verify.mutate()}
        >
          Verify →
        </Button>
        <Stack sx={{ alignItems: 'center', mt: 1.75 }}>
          <Link
            component="button"
            type="button"
            underline="hover"
            color="text.secondary"
            sx={{ fontSize: 14 }}
            disabled={send.isPending}
            onClick={() => send.mutate()}
          >
            Resend email
          </Link>
        </Stack>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={brand ? `Sign in to ${brand.name}` : 'Sign in to Trackly'}
      brand={brand}
      subtitle={
        brand ? (
          <>Track your support requests in one place. No password needed — ever.</>
        ) : (
          <>Welcome back. No password needed — ever.</>
        )
      }
    >
      <Button fullWidth size="large" variant="outlined" color="inherit" disabled sx={{ borderColor: '#CBD5E1', color: '#334155' }}>
        Continue with Google (coming soon)
      </Button>
      <Divider sx={{ my: 2.75, fontSize: 13, color: 'text.secondary' }}>or sign in with email</Divider>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          beginLogin()
        }}
      >
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: '#334155', mb: 0.75 }}>Work email</Typography>
        <TextField
          fullWidth
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        <Button
          fullWidth
          size="large"
          variant="contained"
          type="submit"
          sx={{ mt: 3, ...brandBtn }}
          disabled={!email.includes('@') || send.isPending || checkingSso}
        >
          {checkingSso ? 'Checking…' : '✉️ Continue →'}
        </Button>
      </form>
      <Typography align="center" sx={{ fontSize: 13, color: '#94A3B8', mt: 1.5 }}>
        We'll send a magic link + 6-digit code. Click the link or type the code — you're in.
      </Typography>
    </AuthCard>
  )
}
