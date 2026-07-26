import { Box, Button, IconButton, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createCannedResponse,
  deleteCannedResponse,
  listCannedResponses,
  updateCannedResponse,
} from '../../api/canned'
import { AppShell } from '../../components/AppShell'
import { shadows } from '../../theme'

export function CannedResponsesPage() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const listQuery = useQuery({ queryKey: ['canned'], queryFn: listCannedResponses })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['canned'] })

  const reset = () => {
    setEditingId(null)
    setTitle('')
    setBody('')
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = { title: title.trim(), body: body.trim() }
      return editingId ? updateCannedResponse(editingId, payload) : createCannedResponse(payload)
    },
    onSuccess: () => {
      invalidate()
      reset()
    },
  })
  const remove = useMutation({ mutationFn: deleteCannedResponse, onSuccess: () => { invalidate(); reset() } })

  const items = listQuery.data ?? []

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Canned responses</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Reusable reply snippets. Insert them from the ⚡ button in a ticket's reply box.
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, flex: 1, maxWidth: 480, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 2 }}>{editingId ? 'Edit snippet' : 'New snippet'}</Typography>
          <TextField fullWidth size="small" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} sx={{ mb: 2 }} />
          <TextField fullWidth multiline minRows={5} label="Body" value={body} onChange={(e) => setBody(e.target.value)} />
          <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
            <Button variant="contained" disabled={!title.trim() || !body.trim() || save.isPending} onClick={() => save.mutate()}>
              {editingId ? 'Save' : 'Add snippet'}
            </Button>
            {editingId && <Button onClick={reset}>Cancel</Button>}
          </Stack>
        </Paper>

        <Box sx={{ flex: 1, width: '100%' }}>
          {items.length === 0 ? (
            <Typography color="text.secondary" sx={{ fontSize: 14 }}>No canned responses yet.</Typography>
          ) : (
            items.map((c) => (
              <Paper key={c.id} variant="outlined" sx={{ borderRadius: '12px', p: 2, mb: 1.25, boxShadow: shadows.soft }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: 14.5, fontWeight: 700, flex: 1 }}>{c.title}</Typography>
                  <Button size="small" onClick={() => { setEditingId(c.id); setTitle(c.title); setBody(c.body) }}>Edit</Button>
                  <IconButton size="small" sx={{ color: 'text.secondary' }} onClick={() => remove.mutate(c.id)}>✕</IconButton>
                </Stack>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5, whiteSpace: 'pre-wrap' }} noWrap>
                  {c.body}
                </Typography>
              </Paper>
            ))
          )}
        </Box>
      </Stack>
    </AppShell>
  )
}
