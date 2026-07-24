import { Alert, Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ANNOUNCEMENT_TYPES,
  createAnnouncement,
  listAnnouncements,
  sendAnnouncement,
  type AnnouncementSummary,
} from '../../api/announcements'
import { AppShell } from '../../components/AppShell'
import { shadows } from '../../theme'

const TYPE_LABEL: Record<string, string> = Object.fromEntries(ANNOUNCEMENT_TYPES.map((t) => [t.value, t.label]))

export function AnnouncementsPage() {
  const queryClient = useQueryClient()
  const [type, setType] = useState('general')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const listQuery = useQuery({ queryKey: ['announcements'], queryFn: listAnnouncements })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['announcements'] })

  const create = useMutation({
    mutationFn: () =>
      createAnnouncement({
        type,
        subject: subject.trim(),
        body: body.trim(),
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }),
    onSuccess: () => {
      setSubject('')
      setBody('')
      setScheduledAt('')
      setMessage({ kind: 'success', text: scheduledAt ? 'Scheduled.' : 'Draft saved. Send it when ready.' })
      invalidate()
    },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  })

  const send = useMutation({
    mutationFn: sendAnnouncement,
    onSuccess: (a) => {
      setMessage({ kind: 'success', text: `Sent to ${a.successCount}/${a.recipientCount} customers.` })
      invalidate()
    },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  })

  const announcements = listQuery.data ?? []

  const statusChip = (a: AnnouncementSummary) => {
    if (a.sentAt)
      return <Chip label={`Sent · ${a.successCount}/${a.recipientCount}`} size="small" sx={{ bgcolor: '#DCFCE7', color: '#15803D' }} />
    if (a.scheduledAt)
      return <Chip label={`Scheduled ${new Date(a.scheduledAt).toLocaleString()}`} size="small" sx={{ bgcolor: '#DBEAFE', color: '#1D4ED8' }} />
    return <Chip label="Draft" size="small" sx={{ bgcolor: '#F1F5F9', color: '#64748B' }} />
  }

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Announcements</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Email every customer with a Trackly account — outage notices, maintenance windows, all-clears. Guests are not
        included.
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, flex: 1, maxWidth: 560, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 2 }}>Compose</Typography>
          <TextField select fullWidth label="Type" size="small" value={type} onChange={(e) => setType(e.target.value)} sx={{ mb: 2 }}>
            {ANNOUNCEMENT_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
            ))}
          </TextField>
          <TextField fullWidth label="Subject" size="small" value={subject} onChange={(e) => setSubject(e.target.value)} sx={{ mb: 2 }} />
          <TextField fullWidth label="Message" multiline minRows={5} value={body} onChange={(e) => setBody(e.target.value)} sx={{ mb: 2 }} />
          <TextField
            fullWidth
            type="datetime-local"
            size="small"
            label="Schedule for (optional)"
            slotProps={{ inputLabel: { shrink: true } }}
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            sx={{ mb: 2 }}
          />
          {message && <Alert severity={message.kind} sx={{ mb: 2 }}>{message.text}</Alert>}
          <Button
            variant="contained"
            disabled={!subject.trim() || !body.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {scheduledAt ? 'Schedule announcement' : 'Save draft'}
          </Button>
        </Paper>

        <Box sx={{ flex: 1, width: '100%' }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.5 }}>History</Typography>
          {announcements.length === 0 ? (
            <Typography color="text.secondary" sx={{ fontSize: 14 }}>No announcements yet.</Typography>
          ) : (
            announcements.map((a) => (
              <Paper key={a.id} variant="outlined" sx={{ borderRadius: '12px', p: 2, mb: 1.5, boxShadow: shadows.soft }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Chip label={TYPE_LABEL[a.type] ?? a.type} size="small" sx={{ bgcolor: '#EEF2FF', color: '#4F46E5', fontSize: 11 }} />
                  <Box sx={{ flex: 1 }} />
                  {statusChip(a)}
                </Stack>
                <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>{a.subject}</Typography>
                {!a.sentAt && (
                  <Button size="small" variant="contained" sx={{ mt: 1 }} disabled={send.isPending} onClick={() => send.mutate(a.id)}>
                    Send now
                  </Button>
                )}
                {a.sentAt && a.failureCount > 0 && (
                  <Typography sx={{ fontSize: 12.5, color: 'error.main', mt: 0.5 }}>{a.failureCount} failed</Typography>
                )}
              </Paper>
            ))
          )}
        </Box>
      </Stack>
    </AppShell>
  )
}
