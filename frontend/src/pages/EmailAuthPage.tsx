import {
  Alert,
  Button,
  Divider,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { sendMagicLink, verifyMagicLink, type VerifyResponse, type WorkspaceSummary } from '../api/auth'
import { getPublicBranding } from '../api/guest'
import { discoverSso } from '../api/sso'
import { AuthCard } from '../components/AuthCard'
import { CodeInput } from '../components/CodeInput'
import { savePendingAuth } from '../lib/pendingAuth'
import { useAuthCompletion } from './useAuthCompletion'

interface EmailAuthPageProps {
  mode: 'login' | 'signup'
}

// Login and onboarding step 1 share this screen: enter an email, then either
// click the emailed link (handled by VerifyPage) or type the 6-digit code here.
export function EmailAuthPage({ mode }: EmailAuthPageProps) {
  const [phase, setPhase] = useState<'email' | 'code' | 'choose'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [params0] = useSearchParams()
  const [error, setError] = useState<string | null>(params0.get('sso_error'))
  const [checkingSso, setCheckingSso] = useState(false)
  const navigate = useNavigate()
  const completeAuth = useAuthCompletion()

  // A customer arriving from a workspace's branded submit form or portal link
  // carries ?workspace=slug — that scopes the magic link to one workspace and
  // skips the "choose a workspace" step entirely.
  const [params] = useSearchParams()
  const scopedSlug = params.get('workspace') ?? undefined
  const { data: scopedWorkspace } = useQuery({
    queryKey: ['branding', scopedSlug],
    queryFn: () => getPublicBranding(scopedSlug!),
    enabled: !!scopedSlug,
    retry: false,
    staleTime: 60_000,
  })

  // Login flow: for the Trackly-wide login, first check whether the email's
  // domain routes to a workspace's SSO. If so, hand off to the IdP; otherwise
  // fall back to the magic link. (Branded per-workspace logins skip discovery.)
  const beginLogin = async () => {
    if (!email.includes('@')) return
    setError(null)
    if (!scopedSlug) {
      setCheckingSso(true)
      try {
        const discovery = await discoverSso(email)
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

  const handleVerifyResponse = (res: VerifyResponse) => {
    if (res.status === 'ok') {
      completeAuth(res.user)
    } else if (res.status === 'signup_required') {
      savePendingAuth({ email: res.email, code })
      navigate('/onboarding/workspace')
    } else {
      setWorkspaces(res.workspaces)
      setPhase('choose')
    }
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
    mutationFn: (workspaceSlug?: string) => verifyMagicLink({ email, code, workspaceSlug: workspaceSlug ?? scopedSlug }),
    onSuccess: handleVerifyResponse,
    onError: (e: Error) => setError(e.message),
  })

  const isSignup = mode === 'signup'
  const brand = scopedWorkspace
    ? { name: scopedWorkspace.workspaceName, logoUrl: scopedWorkspace.logoUrl, color: scopedWorkspace.primaryColor }
    : null
  const brandBtn = brand
    ? { bgcolor: brand.color, '&:hover': { bgcolor: brand.color, filter: 'brightness(0.92)' } }
    : undefined

  if (phase === 'choose') {
    return (
      <AuthCard title="Choose a workspace" subtitle={<>Your email belongs to more than one workspace.</>}>
        <List>
          {workspaces.map((w) => (
            <ListItemButton
              key={w.slug}
              onClick={() => verify.mutate(w.slug)}
              disabled={verify.isPending}
              sx={{ border: '1.5px solid #E2E8F0', borderRadius: '12px', mb: 1 }}
            >
              <ListItemText primary={w.name} secondary={`${w.slug}.trackly.com`} />
            </ListItemButton>
          ))}
        </List>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </AuthCard>
    )
  }

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
        stepsDone={isSignup ? 1 : undefined}
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
          onClick={() => verify.mutate(undefined)}
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
      title={isSignup ? 'Create your account' : brand ? `Sign in to ${brand.name}` : 'Sign in to Trackly'}
      brand={brand}
      subtitle={
        isSignup ? (
          <>
            You'll be the administrator of your new workspace.
            <br />
            No password needed — ever.
          </>
        ) : brand ? (
          <>Track your support requests in one place. No password needed — ever.</>
        ) : (
          <>Welcome back. No password needed — ever.</>
        )
      }
      stepsDone={isSignup ? 1 : undefined}
    >
      <Button fullWidth size="large" variant="outlined" color="inherit" disabled sx={{ borderColor: '#CBD5E1', color: '#334155' }}>
        Continue with Google (coming soon)
      </Button>
      <Divider sx={{ my: 2.75, fontSize: 13, color: 'text.secondary' }}>
        {isSignup ? 'or sign up with email' : 'or sign in with email'}
      </Divider>
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
      {/* Never advertise Trackly on a workspace-branded surface */}
      <Typography align="center" sx={{ fontSize: 14, mt: 2.5, display: brand ? 'none' : 'block' }}>
        {isSignup ? (
          <>
            Already have a workspace?{' '}
            <Link component={RouterLink} to="/login" underline="hover">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Trackly?{' '}
            <Link component={RouterLink} to="/signup" underline="hover">
              Start free
            </Link>
          </>
        )}
      </Typography>
    </AuthCard>
  )
}
