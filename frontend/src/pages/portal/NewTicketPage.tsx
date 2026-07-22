import { Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createTicket, listCategories, uploadAttachment } from '../../api/tickets'
import { AppShell } from '../../components/AppShell'
import { formatBytes } from '../../lib/format'
import { shadows } from '../../theme'

export function NewTicketPage() {
  const [subject, setSubject] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: listCategories })

  const submit = useMutation({
    mutationFn: async () => {
      const ticket = await createTicket({
        subject,
        description,
        categoryId: categoryId || undefined,
      })
      if (file) await uploadAttachment(ticket.id, file)
      return ticket
    },
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ['portal-tickets'] })
      navigate(`/portal/tickets/${ticket.id}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const label = { fontSize: 13.5, fontWeight: 600, color: 'text.primary', mb: 0.75 }

  return (
    <AppShell>
      <Box sx={{ maxWidth: 640 }}>
        <Typography sx={{ fontSize: 21, fontWeight: 800, mb: 2.5 }}>New ticket</Typography>
        <Paper variant="outlined" sx={{ borderRadius: '18px', p: 3.5, boxShadow: shadows.soft }}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (subject.trim() && description.trim()) submit.mutate()
            }}
          >
            <Typography sx={label}>Subject</Typography>
            <TextField
              fullWidth
              placeholder="Brief summary of the problem"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
            />

            <Typography sx={{ ...label, mt: 2 }}>Category</Typography>
            <TextField select fullWidth value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <MenuItem value="">No category</MenuItem>
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>

            <Typography sx={{ ...label, mt: 2 }}>Message</Typography>
            <TextField
              fullWidth
              multiline
              minRows={5}
              placeholder="Describe what happened, what you expected, and any error messages…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <input ref={fileInput} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 2 }}>
              <Button size="small" sx={{ color: 'text.secondary' }} onClick={() => fileInput.current?.click()}>
                📎 Attach a file
              </Button>
              {file && (
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                  {file.name} ({formatBytes(file.size)})
                </Typography>
              )}
            </Stack>

            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
              <Button
                variant="contained"
                size="large"
                type="submit"
                disabled={!subject.trim() || !description.trim() || submit.isPending}
              >
                Submit ticket
              </Button>
              <Button size="large" sx={{ color: 'text.secondary' }} onClick={() => navigate('/portal')}>
                Cancel
              </Button>
            </Stack>
          </form>
        </Paper>
      </Box>
    </AppShell>
  )
}
