import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listTickets } from '../../api/tickets'
import { AppShell } from '../../components/AppShell'
import { STATUS_CHIP, timeAgo } from '../../lib/format'
import { shadows } from '../../theme'

type Tab = 'open' | 'resolved' | 'all'

export function PortalTicketsPage() {
  const [tab, setTab] = useState<Tab>('open')
  const navigate = useNavigate()

  const { data, isPending } = useQuery({
    queryKey: ['portal-tickets'],
    queryFn: () => listTickets({ pageSize: 100 }),
  })

  const tickets = data?.items ?? []
  const open = tickets.filter((t) => t.status === 'open' || t.status === 'pending')
  const resolved = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed')
  const shown = tab === 'open' ? open : tab === 'resolved' ? resolved : tickets

  const tabs: { key: Tab; label: string }[] = [
    { key: 'open', label: `Open (${open.length})` },
    { key: 'resolved', label: `Resolved (${resolved.length})` },
    { key: 'all', label: `All (${tickets.length})` },
  ]

  return (
    <AppShell>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2.25 }}>
        <Typography sx={{ fontSize: 21, fontWeight: 800 }}>My tickets</Typography>
        <Button variant="contained" onClick={() => navigate('/portal/tickets/new')}>
          + New ticket
        </Button>
      </Stack>

      <Stack direction="row" spacing={0.75} sx={{ mb: 2 }}>
        {tabs.map((t) => (
          <Box
            key={t.key}
            onClick={() => setTab(t.key)}
            sx={{
              px: 2,
              py: 1,
              borderRadius: '9px',
              fontSize: 13.5,
              fontWeight: 600,
              cursor: 'pointer',
              color: tab === t.key ? 'primary.main' : 'text.secondary',
              bgcolor: tab === t.key ? 'action.selected' : 'transparent',
            }}
          >
            {t.label}
          </Box>
        ))}
      </Stack>

      {isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : shown.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{ borderRadius: '18px', p: 5, textAlign: 'center', color: 'text.secondary' }}
        >
          <Typography sx={{ fontSize: 36, mb: 1 }}>🎫</Typography>
          No tickets here yet. Need help? Open a new ticket.
        </Paper>
      ) : (
        shown.map((ticket) => {
          const chip = STATUS_CHIP[ticket.status] ?? STATUS_CHIP.open
          return (
            <Paper
              key={ticket.id}
              variant="outlined"
              onClick={() => navigate(`/portal/tickets/${ticket.id}`)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2.25,
                borderRadius: '14px',
                px: 2.75,
                py: 2.25,
                mb: 1.5,
                cursor: 'pointer',
                boxShadow: shadows.soft,
                opacity: ticket.status === 'resolved' || ticket.status === 'closed' ? 0.7 : 1,
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600, fontSize: 15 }} noWrap>
                  {ticket.subject}
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.5 }}>
                  {ticket.category ? `${ticket.category.name} · ` : ''}
                  Updated {timeAgo(ticket.updatedAt)} ago
                  {ticket.commentCount > 0
                    ? ` · ${ticket.commentCount} repl${ticket.commentCount === 1 ? 'y' : 'ies'}`
                    : ''}
                </Typography>
              </Box>
              <Chip label={chip.label} size="small" sx={{ bgcolor: chip.bg, color: chip.fg, fontSize: 11.5 }} />
            </Paper>
          )
        })
      )}
    </AppShell>
  )
}
