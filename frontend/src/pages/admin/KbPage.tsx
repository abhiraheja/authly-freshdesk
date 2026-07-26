import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  createKbArticle,
  deleteKbArticle,
  getKbArticle,
  listKbArticles,
  updateKbArticle,
  type KbArticleSummary,
} from '../../api/kb'
import { listCategories } from '../../api/tickets'
import { AppShell } from '../../components/AppShell'
import { shadows } from '../../theme'

type Editing = { id: string | null } | null

export function KbPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Editing>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('draft')

  const listQuery = useQuery({ queryKey: ['kb'], queryFn: listKbArticles })
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: listCategories })
  const editQuery = useQuery({
    queryKey: ['kb', editing?.id],
    queryFn: () => getKbArticle(editing!.id!),
    enabled: !!editing?.id,
  })

  useEffect(() => {
    if (editing?.id && editQuery.data) {
      setTitle(editQuery.data.title)
      setBody(editQuery.data.body)
      setCategoryId(editQuery.data.categoryId ?? '')
      setStatus(editQuery.data.status)
    }
  }, [editing?.id, editQuery.data])

  const startNew = () => {
    setEditing({ id: null })
    setTitle('')
    setBody('')
    setCategoryId('')
    setStatus('draft')
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['kb'] })

  const save = useMutation({
    mutationFn: () => {
      const payload = { title: title.trim(), body: body.trim(), categoryId: categoryId || null, status }
      return editing?.id ? updateKbArticle(editing.id, payload) : createKbArticle(payload)
    },
    onSuccess: () => {
      invalidate()
      setEditing(null)
    },
  })
  const remove = useMutation({ mutationFn: deleteKbArticle, onSuccess: () => { invalidate(); setEditing(null) } })

  const articles = listQuery.data ?? []
  const categories = categoriesQuery.data ?? []

  if (editing) {
    return (
      <AppShell>
        <Button size="small" sx={{ mb: 2 }} onClick={() => setEditing(null)}>← Back to articles</Button>
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, maxWidth: 720, boxShadow: shadows.soft }}>
          <TextField fullWidth label="Title" value={title} onChange={(e) => setTitle(e.target.value)} sx={{ mb: 2 }} />
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField select fullWidth label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <MenuItem value="">None</MenuItem>
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
              ))}
            </TextField>
            <TextField select fullWidth label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <MenuItem value="draft">Draft</MenuItem>
              <MenuItem value="published">Published</MenuItem>
            </TextField>
          </Stack>
          <TextField fullWidth multiline minRows={10} label="Body" value={body} onChange={(e) => setBody(e.target.value)} />
          <Stack direction="row" spacing={1.5} sx={{ mt: 2.5 }}>
            <Button variant="contained" disabled={!title.trim() || !body.trim() || save.isPending} onClick={() => save.mutate()}>
              {status === 'published' ? 'Save & publish' : 'Save draft'}
            </Button>
            {editing.id && (
              <Button color="error" disabled={remove.isPending} onClick={() => remove.mutate(editing.id!)}>Delete</Button>
            )}
          </Stack>
        </Paper>
      </AppShell>
    )
  }

  const row = (a: KbArticleSummary) => (
    <Paper key={a.id} variant="outlined" onClick={() => setEditing({ id: a.id })}
      sx={{ borderRadius: '12px', p: 2, mb: 1.25, cursor: 'pointer', boxShadow: shadows.soft }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 14.5, fontWeight: 700, flex: 1 }} noWrap>{a.title}</Typography>
        <Chip label={a.status} size="small" sx={{
          textTransform: 'capitalize',
          bgcolor: a.status === 'published' ? '#DCFCE7' : '#F1F5F9',
          color: a.status === 'published' ? '#15803D' : '#64748B',
        }} />
      </Stack>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.5 }}>
        {a.categoryName ?? 'Uncategorised'}
      </Typography>
    </Paper>
  )

  return (
    <AppShell>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Knowledge base</Typography>
        <Button variant="contained" onClick={startNew}>New article</Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Published articles appear on your branded help centre and are suggested as customers type a ticket subject.
      </Typography>
      <Box sx={{ maxWidth: 620 }}>
        {articles.length === 0 ? (
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>No articles yet.</Typography>
        ) : (
          articles.map(row)
        )}
      </Box>
    </AppShell>
  )
}
