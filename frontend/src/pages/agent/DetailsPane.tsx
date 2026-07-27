import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  MenuItem,
  Rating,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { draftKbArticle, getAiAvailability, suggestTriage, type TriageSuggestion } from '../../api/ai'
import { getTicketCsat } from '../../api/csat'
import { createKbArticle } from '../../api/kb'
import { listTags } from '../../api/tags'
import { listTeams } from '../../api/teams'
import {
  addWatcher,
  getTicket,
  listAgents,
  listCategories,
  removeWatcher,
  setTicketTags,
  updateTicket,
  type UpdateTicketBody,
} from '../../api/tickets'
import { SlaBadge } from '../../components/SlaBadge'
import { PRIORITY_CHIP, STATUS_CHIP, avatarColor, formatDateTime, initials } from '../../lib/format'
import { useAuthStore } from '../../store/auth'

function Label({ children }: { children: string }) {
  return (
    <Typography
      sx={{
        fontSize: 11.5,
        fontWeight: 700,
        color: 'text.secondary',
        textTransform: 'uppercase',
        letterSpacing: '.7px',
        mb: 1,
      }}
    >
      {children}
    </Typography>
  )
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', py: 0.6 }}>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>{k}</Typography>
      <Box sx={{ fontWeight: 600, fontSize: 13.5 }}>{children}</Box>
    </Stack>
  )
}

export function DetailsPane({ ticketId }: { ticketId: string }) {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const [reassigning, setReassigning] = useState(false)
  const [addingWatcher, setAddingWatcher] = useState(false)

  const ticketQuery = useQuery({ queryKey: ['ticket', ticketId], queryFn: () => getTicket(ticketId) })
  const agentsQuery = useQuery({ queryKey: ['agents'], queryFn: listAgents })
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: listCategories })
  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: listTags })
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: listTeams })
  const csatQuery = useQuery({ queryKey: ['csat', ticketId], queryFn: () => getTicketCsat(ticketId) })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
    queryClient.invalidateQueries({ queryKey: ['agent-tickets'] })
  }

  const setTags = useMutation({
    mutationFn: (names: string[]) => setTicketTags(ticketId, names),
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })

  const update = useMutation({
    mutationFn: (body: UpdateTicketBody) => updateTicket(ticketId, body),
    onSuccess: invalidate,
  })
  const watch = useMutation({ mutationFn: (agentId: string) => addWatcher(ticketId, agentId), onSuccess: invalidate })
  const unwatch = useMutation({
    mutationFn: (agentId: string) => removeWatcher(ticketId, agentId),
    onSuccess: invalidate,
  })

  // AI copilot (agent-reviewed suggestions; never auto-applied)
  const aiQuery = useQuery({ queryKey: ['ai-available'], queryFn: getAiAvailability, staleTime: 60_000 })
  const aiOn = aiQuery.data?.available === true
  const [triage, setTriage] = useState<TriageSuggestion | null>(null)
  const [kbDraft, setKbDraft] = useState<{ title: string; body: string } | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  const suggest = useMutation({
    mutationFn: () => suggestTriage(ticketId),
    onSuccess: (s) => {
      setTriage(s)
      setAiError(null)
    },
    onError: (e: Error) => setAiError(e.message),
  })
  const draftKb = useMutation({
    mutationFn: () => draftKbArticle(ticketId),
    onSuccess: (d) => {
      setKbDraft(d)
      setAiError(null)
    },
    onError: (e: Error) => setAiError(e.message),
  })
  const createArticle = useMutation({
    mutationFn: (d: { title: string; body: string }) => createKbArticle({ title: d.title, body: d.body, status: 'draft' }),
    onSuccess: () => {
      setKbDraft(null)
      queryClient.invalidateQueries({ queryKey: ['kb'] })
    },
    onError: (e: Error) => setAiError(e.message),
  })

  const ticket = ticketQuery.data
  if (!ticket) return <Box sx={{ bgcolor: 'background.paper', borderLeft: '1px solid', borderColor: 'divider' }} />

  const agents = agentsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const teams = teamsQuery.data ?? []
  const watcherIds = new Set(ticket.watchers.map((w) => w.agent.id))
  const priorityChip = PRIORITY_CHIP[ticket.priority] ?? PRIORITY_CHIP.medium
  const requesterName = ticket.requester?.name ?? ticket.requester?.email ?? ticket.guestName ?? 'Guest'

  const applyTriage = () => {
    if (!triage) return
    const body: UpdateTicketBody = { priority: triage.priority }
    const cat = categories.find((c) => c.name === triage.category)
    if (cat) body.categoryId = cat.id
    update.mutate(body)
    if (triage.tags.length) {
      setTags.mutate(Array.from(new Set([...ticket.tags.map((t) => t.name), ...triage.tags])))
    }
    setTriage(null)
  }

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        borderLeft: '1px solid',
        borderColor: 'divider',
        overflowY: 'auto',
        p: 2.5,
      }}
    >
      <Typography sx={{ fontSize: 14.5, fontWeight: 700, mb: 2 }}>Ticket details</Typography>

      {/* AI copilot — suggestions only; the agent applies them */}
      {aiOn && (
        <Box sx={{ mb: 2.25, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Label>AI copilot</Label>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button size="small" variant="outlined" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
              {suggest.isPending ? 'Analyzing…' : '✨ Suggest triage'}
            </Button>
            <Button size="small" variant="outlined" disabled={draftKb.isPending} onClick={() => draftKb.mutate()}>
              {draftKb.isPending ? 'Drafting…' : '✨ Draft KB article'}
            </Button>
          </Stack>
          {aiError && (
            <Alert severity="error" sx={{ mt: 1.25 }} onClose={() => setAiError(null)}>
              {aiError}
            </Alert>
          )}
          {triage && (
            <Box
              sx={{
                mt: 1.5,
                p: 1.5,
                borderRadius: '10px',
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'action.hover',
              }}
            >
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
                <Chip size="small" label={`priority: ${triage.priority}`} />
                {triage.category && <Chip size="small" label={`category: ${triage.category}`} />}
                <Chip size="small" label={`sentiment: ${triage.sentiment}`} />
                {triage.tags.map((t) => (
                  <Chip key={t} size="small" variant="outlined" label={t} />
                ))}
              </Stack>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 1.25 }}>{triage.rationale}</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" onClick={applyTriage}>
                  Apply
                </Button>
                <Button size="small" sx={{ color: 'text.secondary' }} onClick={() => setTriage(null)}>
                  Dismiss
                </Button>
              </Stack>
            </Box>
          )}
        </Box>
      )}

      {/* Assignee */}
      <Box sx={{ mb: 2.25, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Label>Assignee</Label>
        {ticket.assignee ? (
          <Stack direction="row" spacing={1.1} sx={{ alignItems: 'center', py: 0.6 }}>
            <Avatar
              sx={{
                width: 26,
                height: 26,
                fontSize: 10.5,
                fontWeight: 700,
                bgcolor: avatarColor(ticket.assignee.name ?? ticket.assignee.email),
              }}
            >
              {initials(ticket.assignee.name ?? ticket.assignee.email)}
            </Avatar>
            <Typography sx={{ fontSize: 13.5 }}>
              {ticket.assignee.name ?? ticket.assignee.email}
              {ticket.assignee.id === user?.id && (
                <Box component="span" sx={{ color: 'text.secondary', fontSize: 12 }}> · you</Box>
              )}
            </Typography>
          </Stack>
        ) : (
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', py: 0.6 }}>Unassigned</Typography>
        )}
        {reassigning ? (
          <TextField
            select
            size="small"
            fullWidth
            autoFocus
            value={ticket.assignee?.id ?? ''}
            onChange={(e) => {
              update.mutate({ assigneeId: e.target.value })
              setReassigning(false)
            }}
            sx={{ mt: 0.75 }}
          >
            {agents.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name ?? a.email}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Link
            component="button"
            underline="none"
            sx={{ fontSize: 13, fontWeight: 600, mt: 0.5 }}
            onClick={() => setReassigning(true)}
          >
            Reassign
          </Link>
        )}
      </Box>

      {/* Watchers */}
      <Box sx={{ mb: 2.25, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Label>Watchers</Label>
        {ticket.watchers.map((w) => (
          <Stack key={w.agent.id} direction="row" spacing={1.1} sx={{ alignItems: 'center', py: 0.6 }}>
            <Avatar
              sx={{
                width: 26,
                height: 26,
                fontSize: 10.5,
                fontWeight: 700,
                bgcolor: avatarColor(w.agent.name ?? w.agent.email),
              }}
            >
              {initials(w.agent.name ?? w.agent.email)}
            </Avatar>
            <Typography sx={{ fontSize: 13.5, flex: 1 }}>{w.agent.name ?? w.agent.email}</Typography>
            <IconButton
              size="small"
              sx={{ fontSize: 13, color: 'text.secondary' }}
              onClick={() => unwatch.mutate(w.agent.id)}
              aria-label="Remove watcher"
            >
              ✕
            </IconButton>
          </Stack>
        ))}
        {addingWatcher ? (
          <TextField
            select
            size="small"
            fullWidth
            autoFocus
            value=""
            onChange={(e) => {
              watch.mutate(e.target.value)
              setAddingWatcher(false)
            }}
            sx={{ mt: 0.75 }}
          >
            {agents
              .filter((a) => !watcherIds.has(a.id))
              .map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.name ?? a.email}
                </MenuItem>
              ))}
          </TextField>
        ) : (
          <Link
            component="button"
            underline="none"
            sx={{ fontSize: 13, fontWeight: 600, mt: 0.5 }}
            onClick={() => setAddingWatcher(true)}
          >
            + Add watcher
          </Link>
        )}
      </Box>

      {/* Tags */}
      <Box sx={{ mb: 2.25, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Label>Tags</Label>
        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={(tagsQuery.data ?? []).map((t) => t.name)}
          value={ticket.tags.map((t) => t.name)}
          onChange={(_, value) => setTags.mutate(value as string[])}
          renderInput={(params) => (
            <TextField {...params} variant="standard" placeholder="Add tags…" />
          )}
        />
      </Box>

      {/* Facts */}
      <Box sx={{ mb: 2.25, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Row k="ID">#{ticket.id.slice(0, 8)}</Row>
        <Row k="Status">{(STATUS_CHIP[ticket.status] ?? STATUS_CHIP.open).label}</Row>
        <Row k="Priority">
          <TextField
            select
            size="small"
            variant="standard"
            value={ticket.priority}
            onChange={(e) => update.mutate({ priority: e.target.value })}
            slotProps={{ input: { disableUnderline: true } }}
            sx={{ '& .MuiSelect-select': { py: 0 } }}
          >
            {Object.entries(PRIORITY_CHIP).map(([value, chip]) => (
              <MenuItem key={value} value={value}>
                <Chip label={chip.label} size="small" sx={{ bgcolor: chip.bg, color: chip.fg, fontSize: 12 }} />
              </MenuItem>
            ))}
          </TextField>
        </Row>
        <Row k="Category">
          <TextField
            select
            size="small"
            variant="standard"
            value={ticket.category?.id ?? ''}
            onChange={(e) =>
              e.target.value ? update.mutate({ categoryId: e.target.value }) : update.mutate({ clearCategory: true })
            }
            slotProps={{ input: { disableUnderline: true } }}
            sx={{ '& .MuiSelect-select': { py: 0, fontSize: 13.5, fontWeight: 600 } }}
          >
            <MenuItem value="">None</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
        </Row>
        <Row k="Team">
          <TextField
            select
            size="small"
            variant="standard"
            value={ticket.teamId ?? ''}
            onChange={(e) =>
              e.target.value ? update.mutate({ teamId: e.target.value }) : update.mutate({ clearTeam: true })
            }
            slotProps={{ input: { disableUnderline: true } }}
            sx={{ '& .MuiSelect-select': { py: 0, fontSize: 13.5, fontWeight: 600 } }}
          >
            <MenuItem value="">None</MenuItem>
            {teams.map((t) => (
              <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
            ))}
          </TextField>
        </Row>
        {(ticket.firstResponseDueAt || ticket.resolveDueAt) && (
          <Row k="SLA">
            <SlaBadge ticket={ticket} showPrefix />
          </Row>
        )}
        {csatQuery.data?.submitted && csatQuery.data.rating != null && (
          <Row k="Satisfaction">
            <Rating value={csatQuery.data.rating} max={5} readOnly size="small" />
          </Row>
        )}
        <Row k="Channel">{ticket.channel}</Row>
        <Row k="Created">{formatDateTime(ticket.createdAt)}</Row>
        <Box sx={{ mt: 0.5, textAlign: 'right' }}>
          <Chip
            label={priorityChip.label}
            size="small"
            sx={{ bgcolor: priorityChip.bg, color: priorityChip.fg, fontSize: 12 }}
          />
        </Box>
      </Box>

      {/* Requester */}
      <Box>
        <Label>Requester</Label>
        <Stack direction="row" spacing={1.1} sx={{ alignItems: 'center', py: 0.6 }}>
          <Avatar sx={{ width: 26, height: 26, fontSize: 10.5, fontWeight: 700, bgcolor: avatarColor(requesterName) }}>
            {initials(requesterName, 'G')}
          </Avatar>
          <Typography sx={{ fontSize: 13.5 }}>{requesterName}</Typography>
        </Stack>
        <Row k="Email">
          <Typography sx={{ fontSize: 13, fontWeight: 400 }}>
            {ticket.requester?.email ?? ticket.guestEmail ?? '—'}
          </Typography>
        </Row>
      </Box>

      {/* AI-drafted KB article — reviewed and edited before it is saved as a draft */}
      <Dialog open={!!kbDraft} onClose={() => setKbDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>✨ Draft knowledge-base article</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2 }}>
            Generated from this ticket. Review and edit — it will be saved as a <b>draft</b>, not published.
          </Typography>
          <TextField
            fullWidth
            label="Title"
            value={kbDraft?.title ?? ''}
            onChange={(e) => setKbDraft((d) => (d ? { ...d, title: e.target.value } : d))}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            multiline
            minRows={8}
            label="Body (Markdown)"
            value={kbDraft?.body ?? ''}
            onChange={(e) => setKbDraft((d) => (d ? { ...d, body: e.target.value } : d))}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKbDraft(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={createArticle.isPending || !kbDraft?.title.trim() || !kbDraft?.body.trim()}
            onClick={() => kbDraft && createArticle.mutate(kbDraft)}
          >
            {createArticle.isPending ? 'Saving…' : 'Create draft article'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
