import { Box, Button, List, ListItem, Paper, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listTickets } from '../api/tickets'
import { AppShell } from '../components/AppShell'
import { StatCard } from '../components/StatCard'
import { useAuthStore } from '../store/auth'
import { shadows } from '../theme'

const checklist = [
  { label: 'Create your workspace', done: true },
  { label: 'Add your branding', done: false, phase: 'Phase 3' },
  { label: 'Invite agents', done: false, phase: 'Phase 3' },
  { label: 'Connect email', done: false, phase: 'Phase 4' },
  { label: 'Configure SSO', done: false, phase: 'Phase 5' },
] as { label: string; done: boolean; phase?: string }[]

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  // One list call; counts are derived client-side. Replace with a dedicated
  // stats endpoint when ticket volume outgrows a single page.
  const { data } = useQuery({ queryKey: ['dashboard-tickets'], queryFn: () => listTickets({ pageSize: 100 }) })

  const tickets = data?.items ?? []
  const count = (status: string) => tickets.filter((t) => t.status === status).length
  const unassigned = tickets.filter((t) => !t.assignee).length
  const mine = tickets.filter((t) => t.assignee?.id === user?.id).length

  return (
    <AppShell>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' }, mb: 3 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontSize: 24 }}>
            Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Here's what's happening across your support desk today.
          </Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => navigate('/dashboard/tickets')}>
          🎫 Open ticket workspace
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', xl: 'repeat(5, 1fr)' },
          gap: 2,
          mb: 4,
        }}
      >
        <StatCard label="Total tickets" value={data?.total ?? '—'} icon="🎫" tone="primary"
          onClick={() => navigate('/dashboard/tickets')} />
        <StatCard label="Open" value={count('open')} icon="📂" tone="info"
          onClick={() => navigate('/dashboard/tickets')} />
        <StatCard label="Pending" value={count('pending')} icon="⏱" tone="warning" />
        <StatCard label="Resolved" value={count('resolved')} icon="✅" tone="success" />
        <StatCard label="Unassigned" value={unassigned} icon="🙋" tone={unassigned > 0 ? 'error' : 'success'} />
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
        <Paper variant="outlined" sx={{ borderRadius: '18px', p: 3, flex: 1, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 19, fontWeight: 700, mb: 0.5 }}>🚀 Getting started</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14.5, mb: 1.5 }}>
            {checklist.filter((i) => i.done).length} of {checklist.length} complete
          </Typography>
          <List disablePadding>
            {checklist.map((item) => (
              <ListItem
                key={item.label}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '10px',
                  mb: 1,
                  fontSize: 14.5,
                  color: item.done ? 'text.secondary' : 'text.primary',
                  textDecoration: item.done ? 'line-through' : 'none',
                  bgcolor: item.done ? 'surfaceMuted' : 'background.paper',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  {item.done ? '✅' : '⬜'}&nbsp;&nbsp;{item.label}
                </span>
                {!item.done && item.phase && (
                  <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {item.phase}
                  </Box>
                )}
              </ListItem>
            ))}
          </List>
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: '18px', p: 3, flex: 1, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 19, fontWeight: 700, mb: 2 }}>Your queue</Typography>
          <Stack spacing={1.5}>
            <Row label="Assigned to you" value={mine} />
            <Row label="Unassigned" value={unassigned} />
            <Row label="Waiting on a reply" value={count('pending')} />
          </Stack>
          <Button fullWidth sx={{ mt: 2 }} onClick={() => navigate('/dashboard/tickets')}>
            View all tickets →
          </Button>
        </Paper>
      </Stack>
    </AppShell>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography sx={{ fontSize: 14.5, color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ fontSize: 20, fontWeight: 800 }}>{value}</Typography>
    </Stack>
  )
}
