import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getWidget, saveWidget } from '../../api/widget'
import { AppShell } from '../../components/AppShell'
import { useAuthStore } from '../../store/auth'
import { shadows } from '../../theme'

const ALL_FIELDS = ['name', 'email', 'subject', 'description']

export function WidgetPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const [embedType, setEmbedType] = useState('floating')
  const [theme, setTheme] = useState('light')
  const [fields, setFields] = useState<string[]>(ALL_FIELDS)
  const [copied, setCopied] = useState(false)

  const widgetQuery = useQuery({ queryKey: ['widget'], queryFn: getWidget })
  const config = widgetQuery.data

  useEffect(() => {
    if (!config) return
    setEmbedType(config.embedType)
    setTheme(config.theme)
    setFields(config.fields.fields ?? ALL_FIELDS)
  }, [config])

  const save = useMutation({
    mutationFn: () => saveWidget({ embedType, theme, fields: { fields } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['widget'] }),
  })

  const snippet = config?.snippet ?? ''
  const copy = () => {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const toggleField = (f: string) =>
    setFields((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Widget</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Embed a support form on your own site. It shows <b>your</b> brand and opens the same ticketing flow.
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, flex: 1, maxWidth: 480, boxShadow: shadows.soft }}>
          <TextField select fullWidth size="small" label="Embed type" value={embedType}
            onChange={(e) => setEmbedType(e.target.value)} sx={{ mb: 2.5 }}>
            <MenuItem value="floating">Floating button</MenuItem>
            <MenuItem value="inline">Inline iframe</MenuItem>
            <MenuItem value="link">Direct link</MenuItem>
          </TextField>

          <TextField select fullWidth size="small" label="Theme" value={theme}
            onChange={(e) => setTheme(e.target.value)} sx={{ mb: 2.5 }}>
            <MenuItem value="light">Light</MenuItem>
            <MenuItem value="dark">Dark</MenuItem>
          </TextField>

          <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.5 }}>Fields to show</Typography>
          <Stack>
            {ALL_FIELDS.map((f) => (
              <FormControlLabel
                key={f}
                control={<Checkbox size="small" checked={fields.includes(f)} onChange={() => toggleField(f)} />}
                label={<Box component="span" sx={{ textTransform: 'capitalize', fontSize: 14 }}>{f}</Box>}
              />
            ))}
          </Stack>

          <Button variant="contained" sx={{ mt: 2 }} disabled={save.isPending} onClick={() => save.mutate()}>
            Save widget
          </Button>
        </Paper>

        <Box sx={{ flex: 1, width: '100%' }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1 }}>Embed snippet</Typography>
          <Paper variant="outlined" sx={{ borderRadius: '12px', p: 2, bgcolor: 'surfaceMuted', boxShadow: shadows.soft }}>
            <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
              {snippet || '—'}
            </Typography>
          </Paper>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button size="small" variant="outlined" onClick={copy} disabled={!snippet}>
              {copied ? 'Copied ✓' : 'Copy snippet'}
            </Button>
            <Button size="small" href={`/submit?workspace=${user?.workspace.slug}`} target="_blank">
              Preview form ↗
            </Button>
          </Stack>
          {embedType === 'link' && (
            <Alert severity="info" sx={{ mt: 2, fontSize: 13 }}>
              Direct link — no code needed. Share the URL above anywhere.
            </Alert>
          )}
        </Box>
      </Stack>
    </AppShell>
  )
}
