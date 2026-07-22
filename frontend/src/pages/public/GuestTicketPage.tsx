import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { addGuestComment, getGuestTicket, getPublicBranding, guestAttachmentUrl } from '../../api/guest'
import type { Attachment, Comment } from '../../api/tickets'
import { BrandedFrame } from '../../components/BrandedFrame'
import { STATUS_CHIP, formatBytes, formatDateTime } from '../../lib/format'

// Guest magic-link ticket view — no login. Access is proven by the hashed
// token in the URL; the API strips private notes before they reach here.
export function GuestTicketPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const slug = params.get('workspace') ?? ''
  const queryClient = useQueryClient()
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)

  const brandingQuery = useQuery({
    queryKey: ['branding', slug],
    queryFn: () => getPublicBranding(slug),
    enabled: !!slug,
    retry: false,
  })
  const ticketQuery = useQuery({
    queryKey: ['guest-ticket', id, token],
    queryFn: () => getGuestTicket(id, token),
    enabled: !!id && !!token,
    retry: false,
  })

  const send = useMutation({
    mutationFn: () => addGuestComment(id, token, reply),
    onSuccess: () => {
      setReply('')
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['guest-ticket', id, token] })
    },
    onError: (e: Error) => setError(e.message),
  })

  if (brandingQuery.isPending || ticketQuery.isPending) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  const branding = brandingQuery.data
  const ticket = ticketQuery.data
  if (!branding || !ticket) {
    return (
      <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
        This tracking link is invalid or has been revoked.
      </Box>
    )
  }

  const chip = STATUS_CHIP[ticket.status] ?? STATUS_CHIP.open
  const brandBtn = {
    bgcolor: branding.primaryColor,
    boxShadow: 'none',
    '&:hover': { bgcolor: branding.primaryColor, filter: 'brightness(0.92)' },
  }

  const attachmentLink = (a: Attachment) => (
    <Link
      key={a.id}
      href={guestAttachmentUrl(a.id, token)}
      underline="hover"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: '#F8FAFC',
        border: '1px solid #E9E4F5',
        px: 1.5,
        py: 0.8,
        borderRadius: '9px',
        fontSize: 12.5,
        color: '#475569',
        mt: 1,
      }}
    >
      📎 {a.fileName} · {formatBytes(a.sizeBytes)}
    </Link>
  )

  const bubble = (mine: boolean) => ({
    px: 1.9,
    py: 1.5,
    borderRadius: '13px',
    bgcolor: mine ? '#EDE7FB' : '#fff',
    border: mine ? 'none' : '1px solid #E9E4F5',
    borderTopRightRadius: mine ? '4px' : '13px',
    borderTopLeftRadius: mine ? '13px' : '4px',
  })

  const renderComment = (comment: Comment) => {
    const mine = comment.author === null // the guest's own replies have no author
    return (
      <Box key={comment.id} sx={{ maxWidth: '75%', alignSelf: mine ? 'flex-end' : 'flex-start' }}>
        <Typography sx={{ fontSize: 12, color: '#9CA3AF', mb: 0.5, textAlign: mine ? 'right' : 'left' }}>
          {mine ? 'You' : comment.author?.name ?? 'Support'}
          {!mine && (
            <Box
              component="span"
              sx={{
                bgcolor: branding.primaryColor,
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                px: 1,
                py: 0.25,
                borderRadius: 99,
                ml: 0.75,
              }}
            >
              {branding.workspaceName.toUpperCase()} TEAM
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
    <BrandedFrame branding={branding} maxWidth={860}>
      <Box sx={{ bgcolor: '#fff', color: '#1E1B2E', border: '1px solid #E9E4F5', borderRadius: '16px', overflow: 'hidden' }}>
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
            px: 3.25,
            py: 2.5,
            borderBottom: '1px solid #F1EDF9',
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>
              {ticket.reference} · {ticket.subject}
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: '#9CA3AF', mt: 0.4 }}>
              Opened {formatDateTime(ticket.createdAt)}
              {ticket.category ? ` · ${ticket.category.name}` : ''} · tracking as {ticket.guestEmail}
            </Typography>
          </Box>
          <Chip label={chip.label} size="small" sx={{ bgcolor: chip.bg, color: chip.fg }} />
        </Stack>

        <Stack spacing={1.75} sx={{ px: 3.25, py: 3, bgcolor: '#FBFAFE' }}>
          <Box sx={{ maxWidth: '75%', alignSelf: 'flex-end' }}>
            <Typography sx={{ fontSize: 12, color: '#9CA3AF', mb: 0.5, textAlign: 'right' }}>
              You · {formatDateTime(ticket.createdAt)}
            </Typography>
            <Box sx={bubble(true)}>
              <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{ticket.description}</Typography>
              {ticket.ticketAttachments.map(attachmentLink)}
            </Box>
          </Box>
          {ticket.comments.map(renderComment)}
        </Stack>

        <Box sx={{ px: 3.25, py: 2.5, borderTop: '1px solid #F1EDF9' }}>
          <TextField
            fullWidth
            multiline
            minRows={3}
            placeholder="Write a reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 1.25 }}>
            <Typography sx={{ fontSize: 12.5, color: '#9CA3AF' }}>
              💡 Sign in with {ticket.guestEmail} to keep all your tickets in one place
            </Typography>
            <Button variant="contained" sx={brandBtn} disabled={!reply.trim() || send.isPending} onClick={() => send.mutate()}>
              Send
            </Button>
          </Stack>
        </Box>
      </Box>
    </BrandedFrame>
  )
}
