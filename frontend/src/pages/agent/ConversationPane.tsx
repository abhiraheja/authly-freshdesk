import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { draftReply, getAiAvailability, summarizeTicket } from '../../api/ai'
import { listCannedResponses } from '../../api/canned'
import {
  addComment,
  attachmentUrl,
  getTicket,
  listComments,
  listTicketAttachments,
  updateTicket,
  uploadAttachment,
  type Attachment,
  type Comment,
} from '../../api/tickets'
import { formatBytes, formatDateTime, timeAgo } from '../../lib/format'
import { useAuthStore } from '../../store/auth'

function AttachmentLink({ attachment }: { attachment: Attachment }) {
  return (
    <Link
      href={attachmentUrl(attachment.id)}
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
      📎 {attachment.fileName} · {formatBytes(attachment.sizeBytes)}
    </Link>
  )
}

export function ConversationPane({ ticketId }: { ticketId: string }) {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cannedAnchor, setCannedAnchor] = useState<null | HTMLElement>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const cannedQuery = useQuery({ queryKey: ['canned'], queryFn: listCannedResponses })
  const aiQuery = useQuery({ queryKey: ['ai-available'], queryFn: getAiAvailability, staleTime: 60_000 })
  const aiOn = aiQuery.data?.available === true

  // AI copilot: draft fills the composer (agent edits before sending);
  // summarize shows a dismissible recap above the composer. Nothing auto-sends.
  const aiDraft = useMutation({
    mutationFn: () => draftReply(ticketId),
    onSuccess: ({ draft }) => {
      setMode('reply')
      setBody((prev) => (prev.trim() ? `${prev}\n\n${draft}` : draft))
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })
  const aiSummary = useMutation({
    mutationFn: () => summarizeTicket(ticketId),
    onSuccess: ({ summary }) => {
      setSummary(summary)
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })
  const aiBusy = aiDraft.isPending || aiSummary.isPending

  const ticketQuery = useQuery({ queryKey: ['ticket', ticketId], queryFn: () => getTicket(ticketId) })
  const commentsQuery = useQuery({ queryKey: ['comments', ticketId], queryFn: () => listComments(ticketId) })
  const attachmentsQuery = useQuery({
    queryKey: ['attachments', ticketId],
    queryFn: () => listTicketAttachments(ticketId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
    queryClient.invalidateQueries({ queryKey: ['comments', ticketId] })
    queryClient.invalidateQueries({ queryKey: ['attachments', ticketId] })
    queryClient.invalidateQueries({ queryKey: ['agent-tickets'] })
  }

  const send = useMutation({
    mutationFn: async () => {
      const comment = await addComment(ticketId, { body, isInternal: mode === 'note' })
      if (file) await uploadAttachment(ticketId, file, comment.id)
    },
    onSuccess: () => {
      setBody('')
      setFile(null)
      setError(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const setStatus = useMutation({
    mutationFn: (status: string) => updateTicket(ticketId, { status }),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  if (ticketQuery.isPending) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
        <CircularProgress />
      </Box>
    )
  }

  const ticket = ticketQuery.data
  if (!ticket) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">Ticket not found.</Alert>
      </Box>
    )
  }

  const comments = commentsQuery.data ?? []
  const ticketAttachments = (attachmentsQuery.data ?? []).filter((a) => a.commentId === null)
  const requesterName =
    ticket.requester?.name ?? ticket.requester?.email ?? ticket.guestName ?? ticket.guestEmail ?? 'Guest'

  const renderComment = (comment: Comment) => {
    const internal = comment.isInternal
    const isMine = comment.author?.id === user?.id
    const fromTeam = comment.author?.role === 'agent' || comment.author?.role === 'admin'
    const authorName = comment.author?.name ?? comment.author?.email ?? comment.guestEmail ?? 'Guest'
    return (
      <Box key={comment.id} sx={{ maxWidth: '70%', alignSelf: fromTeam ? 'flex-end' : 'flex-start' }}>
        <Typography
          sx={{
            fontSize: 12,
            mb: 0.5,
            color: internal ? 'warning.main' : 'text.secondary',
            fontWeight: internal ? 600 : 400,
            textAlign: fromTeam ? 'right' : 'left',
          }}
        >
          {internal && '🔒 Internal note · '}
          {authorName}
          {isMine && ' (you)'} · {formatDateTime(comment.createdAt)}
        </Typography>
        <Box
          sx={{
            px: 1.9,
            py: 1.5,
            borderRadius: '13px',
            border: internal ? '1px dashed' : '1px solid',
            borderColor: internal ? 'warning.main' : 'divider',
            // Amber tint for private notes — readable in both colour schemes.
            bgcolor: internal
              ? 'rgba(245,158,11,.12)'
              : fromTeam
                ? 'action.selected'
                : 'background.paper',
            borderTopLeftRadius: fromTeam ? '13px' : '4px',
            borderTopRightRadius: fromTeam ? '4px' : '13px',
          }}
        >
          <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{comment.body}</Typography>
          {comment.attachments.map((a) => (
            <AttachmentLink key={a.id} attachment={a} />
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', bgcolor: 'background.default', minHeight: 0 }}>
      {/* Header */}
      <Stack
        direction="row"
        sx={{
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
          px: 2.75,
          py: 1.75,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 16.5, fontWeight: 700 }} noWrap>
            {ticket.subject}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            via {ticket.channel} · opened {timeAgo(ticket.createdAt)} ago
          </Typography>
        </Box>
        <TextField
          select
          size="small"
          value={ticket.status}
          onChange={(e) => setStatus.mutate(e.target.value)}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="open">Open</MenuItem>
          <MenuItem value="pending">Pending</MenuItem>
          <MenuItem value="resolved">Resolved</MenuItem>
          <MenuItem value="closed">Closed</MenuItem>
        </TextField>
      </Stack>

      {/* Thread */}
      <Stack spacing={1.75} sx={{ flex: 1, overflowY: 'auto', p: 2.75 }}>
        <Box sx={{ maxWidth: '70%', alignSelf: 'flex-start' }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
            {requesterName} · {formatDateTime(ticket.createdAt)}
          </Typography>
          <Box
            sx={{
              px: 1.9,
              py: 1.5,
              borderRadius: '13px',
              borderTopLeftRadius: '4px',
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{ticket.description}</Typography>
            {ticketAttachments.map((a) => (
              <AttachmentLink key={a.id} attachment={a} />
            ))}
          </Box>
        </Box>
        {comments.map(renderComment)}
      </Stack>

      {/* AI thread summary (agent-only, dismissible) */}
      {summary && (
        <Alert
          severity="info"
          icon={<span>✨</span>}
          onClose={() => setSummary(null)}
          sx={{ mx: 2.75, mb: 0, alignItems: 'flex-start', '& .MuiAlert-message': { whiteSpace: 'pre-wrap' } }}
        >
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, mb: 0.25 }}>AI summary</Typography>
          {summary}
        </Alert>
      )}

      {/* Composer */}
      <Box
        sx={{
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          px: 2.75,
          pt: 1.75,
          pb: 2.25,
        }}
      >
        <Stack direction="row" spacing={0.5} sx={{ mb: 1.25 }}>
          <Box
            onClick={() => setMode('reply')}
            sx={{
              px: 1.9,
              py: 0.9,
              borderRadius: '8px',
              fontSize: 13.5,
              fontWeight: 600,
              cursor: 'pointer',
              color: mode === 'reply' ? 'primary.main' : 'text.secondary',
              bgcolor: mode === 'reply' ? 'action.selected' : 'transparent',
            }}
          >
            💬 Public reply
          </Box>
          <Box
            onClick={() => setMode('note')}
            sx={{
              px: 1.9,
              py: 0.9,
              borderRadius: '8px',
              fontSize: 13.5,
              fontWeight: 600,
              cursor: 'pointer',
              color: 'warning.main',
              bgcolor: mode === 'note' ? 'action.selected' : 'transparent',
            }}
          >
            🔒 Private note
          </Box>
        </Stack>
        <TextField
          fullWidth
          multiline
          minRows={3}
          placeholder={
            mode === 'reply'
              ? `Reply to ${requesterName}… (visible to the customer)`
              : 'Private note… (only agents and admins can see this)'
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <input ref={fileInput} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 1.25 }}>
          <Stack direction="row" spacing={0.5}>
            <Button size="small" sx={{ color: 'text.secondary' }} onClick={() => fileInput.current?.click()}>
              📎 {file ? `${file.name} (${formatBytes(file.size)})` : 'Attach'}
            </Button>
            {(cannedQuery.data?.length ?? 0) > 0 && (
              <Button size="small" sx={{ color: 'text.secondary' }} onClick={(e) => setCannedAnchor(e.currentTarget)}>
                ⚡ Canned
              </Button>
            )}
            <Menu anchorEl={cannedAnchor} open={!!cannedAnchor} onClose={() => setCannedAnchor(null)}>
              {(cannedQuery.data ?? []).map((c) => (
                <MenuItem
                  key={c.id}
                  onClick={() => {
                    setBody((prev) => (prev.trim() ? `${prev}\n\n${c.body}` : c.body))
                    setCannedAnchor(null)
                  }}
                  sx={{ fontSize: 13.5 }}
                >
                  {c.title}
                </MenuItem>
              ))}
            </Menu>
            {aiOn && (
              <>
                {mode === 'reply' && (
                  <Button
                    size="small"
                    sx={{ color: 'primary.main' }}
                    disabled={aiBusy}
                    onClick={() => aiDraft.mutate()}
                  >
                    {aiDraft.isPending ? '✨ Drafting…' : '✨ Draft reply'}
                  </Button>
                )}
                <Button
                  size="small"
                  sx={{ color: 'primary.main' }}
                  disabled={aiBusy}
                  onClick={() => aiSummary.mutate()}
                >
                  {aiSummary.isPending ? '✨ Summarizing…' : '✨ Summarize'}
                </Button>
              </>
            )}
          </Stack>
          <Button variant="contained" disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>
            {mode === 'reply' ? 'Send reply' : 'Add note'}
          </Button>
        </Stack>
      </Box>
    </Box>
  )
}
