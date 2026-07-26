import { Avatar, Box, Button, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { listAgents } from '../../api/tickets'
import { addTeamMember, createTeam, deleteTeam, listTeams, removeTeamMember, type Team } from '../../api/teams'
import { AppShell } from '../../components/AppShell'
import { avatarColor, initials } from '../../lib/format'
import { shadows } from '../../theme'

export function TeamsPage() {
  const queryClient = useQueryClient()
  const [newTeam, setNewTeam] = useState('')

  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: listTeams })
  const agentsQuery = useQuery({ queryKey: ['agents'], queryFn: listAgents })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['teams'] })

  const create = useMutation({
    mutationFn: () => createTeam(newTeam.trim()),
    onSuccess: () => {
      setNewTeam('')
      invalidate()
    },
  })
  const remove = useMutation({ mutationFn: deleteTeam, onSuccess: invalidate })
  const addMember = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => addTeamMember(teamId, userId),
    onSuccess: invalidate,
  })
  const removeMember = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => removeTeamMember(teamId, userId),
    onSuccess: invalidate,
  })

  const teams = teamsQuery.data ?? []
  const agents = agentsQuery.data ?? []

  const teamCard = (team: Team) => {
    const memberIds = new Set(team.members.map((m) => m.id))
    const available = agents.filter((a) => !memberIds.has(a.id))
    return (
      <Paper key={team.id} variant="outlined" sx={{ borderRadius: '14px', p: 2.5, mb: 2, boxShadow: shadows.soft }}>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700, flex: 1 }}>{team.name}</Typography>
          <IconButton size="small" sx={{ color: 'text.secondary' }} onClick={() => remove.mutate(team.id)}>✕</IconButton>
        </Stack>
        {team.members.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1 }}>No members yet.</Typography>
        ) : (
          team.members.map((m) => (
            <Stack key={m.id} direction="row" spacing={1.25} sx={{ alignItems: 'center', py: 0.6 }}>
              <Avatar sx={{ width: 28, height: 28, fontSize: 11, fontWeight: 700, bgcolor: avatarColor(m.name ?? m.email) }}>
                {initials(m.name ?? m.email)}
              </Avatar>
              <Typography sx={{ fontSize: 13.5, flex: 1 }}>{m.name ?? m.email}</Typography>
              <Button size="small" sx={{ color: 'text.secondary' }}
                onClick={() => removeMember.mutate({ teamId: team.id, userId: m.id })}>
                Remove
              </Button>
            </Stack>
          ))
        )}
        {available.length > 0 && (
          <TextField
            select
            size="small"
            fullWidth
            value=""
            onChange={(e) => addMember.mutate({ teamId: team.id, userId: e.target.value })}
            sx={{ mt: 1 }}
            label="Add member"
          >
            {available.map((a) => (
              <MenuItem key={a.id} value={a.id}>{a.name ?? a.email}</MenuItem>
            ))}
          </TextField>
        )}
      </Paper>
    )
  }

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Teams</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Group agents into teams. Route a ticket to a team and it's round-robin assigned among that team's members.
      </Typography>

      <Box sx={{ maxWidth: 560 }}>
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2.5, mb: 3, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.5 }}>New team</Typography>
          <Stack direction="row" spacing={1}>
            <TextField size="small" fullWidth placeholder="e.g. Billing" value={newTeam}
              onChange={(e) => setNewTeam(e.target.value)} />
            <Button variant="contained" disabled={!newTeam.trim() || create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </Stack>
        </Paper>

        {teams.length === 0 ? (
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>No teams yet.</Typography>
        ) : (
          teams.map(teamCard)
        )}
      </Box>
    </AppShell>
  )
}
