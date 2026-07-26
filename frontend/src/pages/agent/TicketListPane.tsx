import { Avatar, Box, Chip, CircularProgress, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { listTickets } from '../../api/tickets'
import { SlaBadge } from '../../components/SlaBadge'
import { avatarColor, initials, timeAgo } from '../../lib/format'

interface TicketListPaneProps {
  selectedId?: string
  onSelect: (id: string) => void
}

export function TicketListPane({ selectedId, onSelect }: TicketListPaneProps) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('open')

  const { data, isPending } = useQuery({
    queryKey: ['agent-tickets', search, status],
    queryFn: () =>
      listTickets({
        search: search || undefined,
        status: status === 'all' ? undefined : status,
        pageSize: 100,
      }),
  })

  const tickets = data?.items ?? []

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700 }}>Tickets</Typography>
          <Box
            sx={{
              bgcolor: 'action.selected',
              color: 'primary.main',
              fontSize: 12,
              fontWeight: 700,
              px: 1.1,
              py: 0.25,
              borderRadius: 99,
            }}
          >
            {data?.total ?? '…'}
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            placeholder="🔍 Search tickets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 13.5 } }}
          />
          <TextField
            size="small"
            select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            sx={{ width: 110, '& .MuiInputBase-input': { fontSize: 13 } }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="resolved">Resolved</MenuItem>
            <MenuItem value="closed">Closed</MenuItem>
          </TextField>
        </Stack>
      </Box>

      <Box sx={{ overflowY: 'auto', flex: 1 }}>
        {isPending ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={22} />
          </Box>
        ) : tickets.length === 0 ? (
          <Typography sx={{ p: 2.5, fontSize: 13.5, color: 'text.secondary' }}>No tickets match.</Typography>
        ) : (
          tickets.map((ticket) => {
            const requesterName =
              ticket.requester?.name ?? ticket.requester?.email ?? `Guest · ${ticket.guestEmail}`
            const active = ticket.id === selectedId
            return (
              <Stack
                key={ticket.id}
                direction="row"
                spacing={1.4}
                onClick={() => onSelect(ticket.id)}
                sx={{
                  px: 2,
                  py: 1.6,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  cursor: 'pointer',
                  bgcolor: active ? 'action.selected' : 'transparent',
                  borderLeft: active ? '3px solid' : '3px solid transparent',
                  borderLeftColor: active ? 'primary.main' : 'transparent',
                  '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
                }}
              >
                <Avatar
                  sx={{ width: 34, height: 34, fontSize: 12.5, fontWeight: 700, bgcolor: avatarColor(requesterName) }}
                >
                  {initials(requesterName, 'G')}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography sx={{ color: 'text.primary', fontSize: 13, fontWeight: 700 }} noWrap>
                      {requesterName}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {timeAgo(ticket.updatedAt)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, flex: 1 }} noWrap>
                      {ticket.subject}
                    </Typography>
                    <SlaBadge ticket={ticket} />
                  </Stack>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }} noWrap>
                    {ticket.assignee
                      ? `Assigned to ${ticket.assignee.name ?? ticket.assignee.email}`
                      : 'Unassigned'}
                    {` · ${ticket.priority}`}
                  </Typography>
                  {ticket.tags.length > 0 && (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.6, flexWrap: 'wrap', gap: 0.5 }}>
                      {ticket.tags.slice(0, 3).map((tag) => (
                        <Chip
                          key={tag.id}
                          label={tag.name}
                          size="small"
                          sx={{ height: 18, fontSize: 10.5, bgcolor: 'action.selected', color: 'text.secondary' }}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
              </Stack>
            )
          })
        )}
      </Box>
    </Box>
  )
}
