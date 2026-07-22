import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import {
  addComment,
  attachmentUrl,
  getTicket,
  listComments,
  listTicketAttachments,
  uploadAttachment,
  type Attachment,
  type Comment,
} from '../../api/tickets'
import { AppShell } from '../../components/AppShell'
import { STATUS_CHIP, formatBytes, formatDateTime } from '../../lib/format'
import { useAuthStore } from '../../store/auth'

export function PortalTicketDetailPage() {
  const { id = '' } = useParams()
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const [reply, setReply] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const ticketQuery = useQuery({ queryKey: ['ticket', id], queryFn: () => getTicket(id) })
  const commentsQuery = useQuery({ queryKey: ['comments', id], queryFn: () => listComments(id) })
  const attachmentsQuery = useQuery({
    queryKey: ['attachments', id],
    queryFn: () => listTicketAttachments(id),
  })

  const send = useMutation({
    mutationFn: async () => {
      const comment = await addComment(id, { body: reply, isInternal: false })
      if (file) await uploadAttachment(id, file, comment.id)
    },
    onSuccess: () => {
      setReply('')
      setFile(null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['comments', id] })
      queryClient.invalidateQueries({ queryKey: ['attachments', id] })
    },
    onError: (e: Error) => setError(e.message),
  })

  if (ticketQuery.isPending) {
    return (
      <AppShell>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      </AppShell>
    )
  }

  const ticket = ticketQuery.data
  if (!ticket) {
    return (
      <AppShell>
        <Alert severity="error">
          Ticket not found. <Link component={RouterLink} to="/portal">Back to my tickets</Link>
        </Alert>
      </AppShell>
    )
  }

  const chip = STATUS_CHIP[ticket.status] ?? STATUS_CHIP.open
  const comments = commentsQuery.data ?? []
  const ticketAttachments = (attachmentsQuery.data ?? []).filter((a) => a.commentId === null)

  const bubble = (mine: boolean) => ({
    px: 1.9,
    py: 1.5,
    borderRadius: '13px',
    bgcolor: mine ? 'action.selected' : 'background.paper',
    border: '1px solid',
    borderColor: 'divider',
    borderTopRightRadius: mine ? '4px' : '13px',
    borderTopLeftRadius: mine ? '13px' : '4px',
  })

  const attachmentLink = (a: Attachment) => (
    <Link
      key={a.id}
      href={attachmentUrl(a.id)}
      underline="hover"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: 'surfaceMuted',
        border: '1px solid',
        borderColor: 'divider',
        px: 1.5,
        py: 0.8,
        borderRadius: '9px',
        fontSize: 12.5,
        color: 'text.secondary',
        mt: 1,
      }}
    >
      📎 {a.fileName} · {formatBytes(a.sizeBytes)}
    </Link>
  )

  const renderComment = (comment: Comment) => {
    const mine = comment.author?.id === user?.id
    const fromTeam = comment.author?.role === 'agent' || comment.author?.role === 'admin'
    return (
      <Box key={comment.id} sx={{ maxWidth: '75%', alignSelf: mine ? 'flex-end' : 'flex-start' }}>
        <Typography
          sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5, textAlign: mine ? 'right' : 'left' }}
        >
          {mine ? 'You' : comment.author?.name ?? comment.author?.email ?? 'Support'}
          {!mine && fromTeam && (
            <Box
              component="span"
              sx={{
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontSize: 10,
                fontWeight: 700,
                px: 1,
                py: 0.25,
                borderRadius: 99,
                ml: 0.75,
              }}
            >
              TEAM
            </Box>
          )}
          {' · '}
          {formatDateTime(comment.createdAt)}
        </Typography>
        <Box sx={bubble(mine)}>
          <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{comment.body}</Typography>
          {comment.attachments.map(attachmentLink)}
        </Box>
      </Box>
    )
  }

  return (
    <AppShell>
      <Box sx={{ maxWidth: 860, mx: 'auto' }}>
        <Link component={RouterLink} to="/portal" underline="hover" sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          ← My tickets
        </Link>
        <Paper variant="outlined" sx={{ borderRadius: '18px', overflow: 'hidden', mt: 1.5 }}>
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'center',
              px: 3.25,
              py: 2.5,
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box>
              <Typography sx={{ fontSize: 17, fontWeight: 700 }}>{ticket.subject}</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.4 }}>
                Opened {formatDateTime(ticket.createdAt)}
                {ticket.category ? ` · ${ticket.category.name}` : ''}
              </Typography>
            </Box>
            <Chip label={chip.label} size="small" sx={{ bgcolor: chip.bg, color: chip.fg }} />
          </Stack>

          <Stack spacing={1.75} sx={{ px: 3.25, py: 3, bgcolor: 'surfaceMuted' }}>
            {/* The original request renders as the customer's first message */}
            <Box sx={{ maxWidth: '75%', alignSelf: 'flex-end' }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5, textAlign: 'right' }}>
                You · {formatDateTime(ticket.createdAt)}
              </Typography>
              <Box sx={bubble(true)}>
                <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{ticket.description}</Typography>
                {ticketAttachments.map(attachmentLink)}
              </Box>
            </Box>
            {comments.map(renderComment)}
          </Stack>

          <Box sx={{ px: 3.25, py: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
            <TextField
              fullWidth
              multiline
              minRows={3}
              placeholder="Write a reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <input ref={fileInput} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 1.25 }}>
              <Button size="small" sx={{ color: 'text.secondary' }} onClick={() => fileInput.current?.click()}>
                📎 {file ? `${file.name} (${formatBytes(file.size)})` : 'Attach files'}
              </Button>
              <Button variant="contained" disabled={!reply.trim() || send.isPending} onClick={() => send.mutate()}>
                Send
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Box>
    </AppShell>
  )
}
