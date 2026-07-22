import { Alert, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { acceptInvitation, getInvitationInfo } from '../../api/admin'
import { AuthCard } from '../../components/AuthCard'
import { useAuthCompletion } from '../useAuthCompletion'

export function InviteAcceptPage() {
  const { token = '' } = useParams()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const completeAuth = useAuthCompletion()

  const infoQuery = useQuery({
    queryKey: ['invite', token],
    queryFn: () => getInvitationInfo(token),
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () => acceptInvitation(token, name.trim() || undefined),
    onSuccess: (res) => completeAuth(res.user),
    onError: (e: Error) => setError(e.message),
  })

  if (infoQuery.isPending) {
    return (
      <AuthCard title="Checking your invitation…">
        <Stack sx={{ alignItems: 'center', py: 2 }}>
          <CircularProgress />
        </Stack>
      </AuthCard>
    )
  }

  const info = infoQuery.data
  if (!info) {
    return (
      <AuthCard title="Invitation not found" subtitle="This invite link is invalid. Ask your admin to send a new one.">
        <Button fullWidth size="large" variant="contained" href="/login">
          Go to sign in
        </Button>
      </AuthCard>
    )
  }
  if (info.accepted || info.expired) {
    return (
      <AuthCard
        title={info.accepted ? 'Already accepted' : 'Invitation expired'}
        subtitle={
          info.accepted
            ? 'This invitation has already been used. Sign in with your email instead.'
            : 'Invitations are valid for 7 days. Ask your admin to send a new one.'
        }
      >
        <Button fullWidth size="large" variant="contained" href="/login">
          Go to sign in
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={`Join ${info.workspaceName}`}
      subtitle={
        <>
          {info.invitedBy ?? 'An admin'} invited <b>{info.email}</b> to join as{' '}
          <b>{info.role === 'admin' ? 'an admin' : 'an agent'}</b>.
          <br />
          No password needed — accepting signs you in.
        </>
      }
    >
      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'text.primary', mb: 0.75 }}>Your name</Typography>
      <TextField fullWidth placeholder="Monica Reyes" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Button
        fullWidth
        size="large"
        variant="contained"
        sx={{ mt: 3 }}
        disabled={accept.isPending}
        onClick={() => accept.mutate()}
      >
        Accept invitation →
      </Button>
    </AuthCard>
  )
}
