import { Alert, Button, Link } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { verifyMagicLink } from '../api/auth'
import { AuthCard } from '../components/AuthCard'
import { useAuthCompletion } from './useAuthCompletion'

// Magic-link landing page. The token is NEVER consumed on page load (email
// scanners prefetch GETs) — only the explicit confirm button POSTs it.
export function VerifyPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? undefined
  const workspaceSlug = params.get('workspace') ?? undefined
  const [error, setError] = useState<string | null>(null)
  const completeAuth = useAuthCompletion()

  const verify = useMutation({
    mutationFn: () => verifyMagicLink({ token, workspaceSlug }),
    onSuccess: (res) => completeAuth(res.user),
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
        onClick={() => verify.mutate()}
      >
        Confirm sign-in →
      </Button>
    </AuthCard>
  )
}
