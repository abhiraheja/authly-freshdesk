import { Alert, Button, Link, List, ListItemButton, ListItemText } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { verifyMagicLink, type VerifyResponse, type WorkspaceSummary } from '../api/auth'
import { AuthCard } from '../components/AuthCard'
import { savePendingAuth } from '../lib/pendingAuth'
import { useAuthCompletion } from './useAuthCompletion'

// Magic-link landing page. The token is NEVER consumed on page load (email
// scanners prefetch GETs) — only the explicit confirm button POSTs it.
export function VerifyPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? undefined
  const workspaceSlug = params.get('workspace') ?? undefined
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const completeAuth = useAuthCompletion()

  const handleVerifyResponse = (res: VerifyResponse) => {
    if (res.status === 'ok') {
      completeAuth(res.user)
    } else if (res.status === 'signup_required') {
      savePendingAuth({ email: res.email, token })
      navigate('/onboarding/workspace')
    } else {
      setWorkspaces(res.workspaces)
    }
  }

  const verify = useMutation({
    mutationFn: (slug?: string) => verifyMagicLink({ token, workspaceSlug: slug ?? workspaceSlug }),
    onSuccess: handleVerifyResponse,
    onError: (e: Error) => setError(e.message),
  })

  if (!token) {
    return (
      <AuthCard title="Invalid sign-in link" subtitle="This link is missing its sign-in token.">
        <Button fullWidth size="large" variant="contained" component={RouterLink} to="/login">
          Back to sign in
        </Button>
      </AuthCard>
    )
  }

  if (workspaces) {
    return (
      <AuthCard title="Choose a workspace" subtitle="Your email belongs to more than one workspace.">
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

  return (
    <AuthCard
      title="Confirm sign-in"
      subtitle="Click the button below to finish signing in. This keeps automated email scanners from using your link."
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}{' '}
          <Link component={RouterLink} to="/login" underline="hover">
            Request a new link
          </Link>
        </Alert>
      )}
      <Button
        fullWidth
        size="large"
        variant="contained"
        disabled={verify.isPending}
        onClick={() => verify.mutate(undefined)}
      >
        Confirm sign-in →
      </Button>
    </AuthCard>
  )
}
