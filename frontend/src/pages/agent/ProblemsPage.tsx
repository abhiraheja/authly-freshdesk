import { Alert, Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createProblem,
  getProblem,
  listProblems,
  PROBLEM_STATUSES,
  resolveProblem,
  unlinkTicket,
  updateProblem,
  type ProblemSummary,
} from '../../api/problems'
import { AppShell } from '../../components/AppShell'
import { shadows } from '../../theme'

const STATUS_CHIP: Record<string, { bg: string; fg: string }> = {
  investigating: { bg: '#FEF3C7', fg: '#B45309' },
  identified: { bg: '#DBEAFE', fg: '#1D4ED8' },
  monitoring: { bg: '#EDE9FE', fg: '#6D28D9' },
  resolved: { bg: '#DCFCE7', fg: '#15803D' },
}

export function ProblemsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const problemsQuery = useQuery({ queryKey: ['problems'], queryFn: listProblems })
  const detailQuery = useQuery({
    queryKey: ['problem', selected],
    queryFn: () => getProblem(selected!),
    enabled: !!selected,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['problems'] })
    if (selected) queryClient.invalidateQueries({ queryKey: ['problem', selected] })
  }

  const create = useMutation({
    mutationFn: () => createProblem({ title: title.trim(), description: description.trim() || undefined }),
    onSuccess: (p) => {
      setTitle('')
      setDescription('')
      setSelected(p.id)
      queryClient.invalidateQueries({ queryKey: ['problems'] })
    },
  })

  const setStatus = useMutation({
    mutationFn: (status: string) => updateProblem(selected!, { status }),
    onSuccess: invalidate,
  })

  const resolve = useMutation({
    mutationFn: () => resolveProblem(selected!, true),
    onSuccess: invalidate,
  })

  const unlink = useMutation({
    mutationFn: (ticketId: string) => unlinkTicket(ticketId),
    onSuccess: invalidate,
  })

  const problems = problemsQuery.data ?? []
  const detail = detailQuery.data

  const card = (p: ProblemSummary) => (
    <Paper
      key={p.id}
      variant="outlined"
      onClick={() => setSelected(p.id)}
      sx={{
        borderRadius: '12px',
        p: 2,
        mb: 1.25,
        cursor: 'pointer',
        boxShadow: shadows.soft,
        borderColor: selected === p.id ? 'primary.main' : 'divider',
        bgcolor: selected === p.id ? 'action.selected' : 'background.paper',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 14.5, fontWeight: 700, flex: 1 }} noWrap>{p.title}</Typography>
        <Chip label={p.status} size="small" sx={{ ...STATUS_CHIP[p.status], fontSize: 11, textTransform: 'capitalize' }} />
      </Stack>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.5 }}>
        {p.ticketCount} linked ticket{p.ticketCount === 1 ? '' : 's'}
        {p.assignee ? ` · ${p.assignee.name ?? p.assignee.email}` : ''}
      </Typography>
    </Paper>
  )

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Problems</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Group related tickets under one root cause. Resolving a problem can close every linked ticket at once. Customers
        never see this grouping.
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ width: { xs: '100%', md: 340 } }}>
          <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2, mb: 2, boxShadow: shadows.soft }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1 }}>New problem</Typography>
            <TextField size="small" fullWidth placeholder="e.g. Payment gateway down" value={title}
              onChange={(e) => setTitle(e.target.value)} sx={{ mb: 1 }} />
            <TextField size="small" fullWidth multiline minRows={2} placeholder="What's the root cause?" value={description}
              onChange={(e) => setDescription(e.target.value)} sx={{ mb: 1 }} />
            <Button variant="contained" fullWidth disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
              Create problem
            </Button>
          </Paper>
          {problems.length === 0 ? (
            <Typography color="text.secondary" sx={{ fontSize: 14 }}>No problems yet.</Typography>
          ) : (
            problems.map(card)
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          {!detail ? (
            <Paper variant="outlined" sx={{ borderRadius: '14px', p: 4, textAlign: 'center', color: 'text.secondary', boxShadow: shadows.soft }}>
              Select a problem to see linked tickets.
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, boxShadow: shadows.soft }}>
              <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                  <Typography sx={{ fontSize: 20, fontWeight: 800 }}>{detail.title}</Typography>
                  {detail.description && (
                    <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }}>{detail.description}</Typography>
                  )}
                </Box>
                <TextField
                  select
                  size="small"
                  value={detail.status}
                  onChange={(e) => setStatus.mutate(e.target.value)}
                  sx={{ width: 150, textTransform: 'capitalize' }}
                >
                  {PROBLEM_STATUSES.map((s) => (
                    <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s}</MenuItem>
                  ))}
                </TextField>
              </Stack>

              {detail.resolvedAt && (
                <Alert severity="success" sx={{ mt: 2 }}>Resolved on {new Date(detail.resolvedAt).toLocaleString()}</Alert>
              )}

              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 3, mb: 1 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Linked tickets ({detail.tickets.length})</Typography>
                {detail.status !== 'resolved' && (
                  <Button size="small" variant="contained" color="success" disabled={resolve.isPending} onClick={() => resolve.mutate()}>
                    Resolve problem + all tickets
                  </Button>
                )}
              </Stack>

              {detail.tickets.length === 0 ? (
                <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
                  No tickets linked yet. Open a ticket and link it to this problem.
                </Typography>
              ) : (
                detail.tickets.map((t) => (
                  <Stack key={t.id} direction="row" sx={{ alignItems: 'center', gap: 1, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 600, cursor: 'pointer' }} noWrap
                        onClick={() => navigate(`/dashboard/tickets/${t.id}`)}>
                        {t.subject}
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                        {t.requester?.name ?? t.guestName ?? t.guestEmail ?? 'Unknown'} · {t.status}
                      </Typography>
                    </Box>
                    <Button size="small" sx={{ color: 'text.secondary' }} onClick={() => unlink.mutate(t.id)}>Unlink</Button>
                  </Stack>
                ))
              )}
            </Paper>
          )}
        </Box>
      </Stack>
    </AppShell>
  )
}
