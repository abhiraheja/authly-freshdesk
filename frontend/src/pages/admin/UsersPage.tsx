import { Alert, Avatar, Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createInvitation, listInvitations, listMembers, revokeInvitation, updateMember } from '../../api/admin'
import { AppShell } from '../../components/AppShell'
import { avatarColor, initials } from '../../lib/format'
import { shadows } from '../../theme'
import { useAuthStore } from '../../store/auth'

const ROLE_CHIP: Record<string, { bg: string; fg: string }> = {
  admin: { bg: '#F5F3FF', fg: '#7C3AED' },
  agent: { bg: '#EEF2FF', fg: '#4F46E5' },
  customer: { bg: '#F1F5F9', fg: '#64748B' },
}

export function UsersPage() {
  const me = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('agent')
  const [error, setError] = useState<string | null>(null)

  const membersQuery = useQuery({ queryKey: ['members'], queryFn: listMembers })
  const invitationsQuery = useQuery({ queryKey: ['invitations'], queryFn: listInvitations })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['members'] })
    queryClient.invalidateQueries({ queryKey: ['invitations'] })
  }

  const invite = useMutation({
    mutationFn: () => createInvitation(inviteEmail, inviteRole),
    onSuccess: () => {
      setInviteEmail('')
      setError(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => updateMember(id, { role }),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const revoke = useMutation({ mutationFn: revokeInvitation, onSuccess: invalidate })

  const members = membersQuery.data ?? []
  const invitations = invitationsQuery.data ?? []

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Team</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Invite agents and admins, and manage member roles. Invitees receive an email with a join link (valid 7 days).
      </Typography>

      <Box sx={{ maxWidth: 720 }}>
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2.5, mb: 3, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.5 }}>Invite your team</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              type="email"
              placeholder="teammate@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <TextField
              size="small"
              select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              sx={{ width: 120 }}
            >
              <MenuItem value="agent">Agent</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
            </TextField>
            <Button
              variant="contained"
              disabled={!inviteEmail.includes('@') || invite.isPending}
              onClick={() => invite.mutate()}
            >
              Invite
            </Button>
          </Stack>
          {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}

          {invitations.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography
                sx={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '.7px',
                  mb: 1,
                }}
              >
                Pending invitations
              </Typography>
              {invitations.map((inv) => (
                <Stack key={inv.id} direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 0.75 }}>
                  <Typography sx={{ fontSize: 13.5, flex: 1 }}>{inv.email}</Typography>
                  <Chip label={inv.role} size="small" sx={{ ...ROLE_CHIP[inv.role], fontSize: 11.5 }} />
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                    expires in {Math.max(1, Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / 86400000))}d
                  </Typography>
                  <Button size="small" sx={{ color: 'text.secondary' }} onClick={() => revoke.mutate(inv.id)}>
                    Revoke
                  </Button>
                </Stack>
              ))}
            </Box>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2.5, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.5 }}>Members ({members.length})</Typography>
          {members.map((member) => {
            const display = member.name ?? member.email ?? '?'
            const isSelf = member.id === me?.id
            return (
              <Stack
                key={member.id}
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <Avatar sx={{ width: 32, height: 32, fontSize: 12.5, fontWeight: 700, bgcolor: avatarColor(display) }}>
                  {initials(display)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
                    {display}
                    {isSelf && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}> · you</Box>}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }} noWrap>
                    {member.email}
                  </Typography>
                </Box>
                {isSelf ? (
                  <Chip label={member.role} size="small" sx={{ ...ROLE_CHIP[member.role], fontSize: 11.5 }} />
                ) : (
                  <TextField
                    size="small"
                    select
                    value={member.role}
                    onChange={(e) => changeRole.mutate({ id: member.id, role: e.target.value })}
                    sx={{ width: 130, '& .MuiInputBase-input': { fontSize: 13 } }}
                  >
                    <MenuItem value="customer">Customer</MenuItem>
                    <MenuItem value="agent">Agent</MenuItem>
                    <MenuItem value="admin">Admin</MenuItem>
                  </TextField>
                )}
              </Stack>
            )
          })}
        </Paper>
      </Box>
    </AppShell>
  )
}
