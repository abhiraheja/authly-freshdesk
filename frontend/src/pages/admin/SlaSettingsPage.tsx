import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { listSlaPolicies, upsertSlaPolicy, type SlaPolicy } from '../../api/sla'
import { AppShell } from '../../components/AppShell'
import { PRIORITY_CHIP } from '../../lib/format'
import { shadows } from '../../theme'

const PRIORITIES = ['urgent', 'high', 'medium', 'low']

// Local editing model uses hours (nicer than minutes); '' means "no target".
interface Row {
  firstResponseHours: string
  resolveHours: string
}

const toHours = (mins: number | null) => (mins == null ? '' : String(mins / 60))
const toMinutes = (hours: string) => {
  const n = Number(hours)
  return hours.trim() && n > 0 ? Math.round(n * 60) : null
}

export function SlaSettingsPage() {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [message, setMessage] = useState<string | null>(null)

  const slaQuery = useQuery({ queryKey: ['sla'], queryFn: listSlaPolicies })

  useEffect(() => {
    if (!slaQuery.data) return
    const byPriority = new Map(slaQuery.data.map((p) => [p.priority, p]))
    const next: Record<string, Row> = {}
    for (const p of PRIORITIES) {
      const policy = byPriority.get(p)
      next[p] = {
        firstResponseHours: toHours(policy?.firstResponseMinutes ?? null),
        resolveHours: toHours(policy?.resolveMinutes ?? null),
      }
    }
    setRows(next)
  }, [slaQuery.data])

  const save = useMutation({
    mutationFn: async () => {
      for (const priority of PRIORITIES) {
        const row = rows[priority]
        const policy: SlaPolicy = {
          priority,
          firstResponseMinutes: toMinutes(row.firstResponseHours),
          resolveMinutes: toMinutes(row.resolveHours),
        }
        await upsertSlaPolicy(policy)
      }
    },
    onSuccess: () => {
      setMessage('SLA targets saved. New tickets use these; the resolve clock pauses while a ticket is pending.')
      queryClient.invalidateQueries({ queryKey: ['sla'] })
    },
    onError: (e: Error) => setMessage(e.message),
  })

  const set = (priority: string, field: keyof Row, value: string) =>
    setRows((prev) => ({ ...prev, [priority]: { ...prev[priority], [field]: value } }))

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>SLA policies</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        First-response and resolution targets per priority, in hours. Leave a field blank for no target. The agent ticket
        list shows a live countdown that turns amber, then red, as a target approaches.
      </Typography>

      <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, maxWidth: 620, boxShadow: shadows.soft }}>
        <Stack direction="row" sx={{ pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ width: 120 }} />
          <Typography sx={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: 'text.secondary' }}>First response (h)</Typography>
          <Typography sx={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: 'text.secondary' }}>Resolution (h)</Typography>
        </Stack>
        {PRIORITIES.map((priority) => {
          const chip = PRIORITY_CHIP[priority] ?? PRIORITY_CHIP.medium
          const row = rows[priority] ?? { firstResponseHours: '', resolveHours: '' }
          return (
            <Stack key={priority} direction="row" spacing={2} sx={{ alignItems: 'center', py: 1.25 }}>
              <Box sx={{ width: 120 }}>
                <Box component="span" sx={{ bgcolor: chip.bg, color: chip.fg, fontSize: 12, fontWeight: 700, px: 1, py: 0.4, borderRadius: 99 }}>
                  {chip.label}
                </Box>
              </Box>
              <TextField size="small" type="number" placeholder="—" value={row.firstResponseHours}
                onChange={(e) => set(priority, 'firstResponseHours', e.target.value)} sx={{ flex: 1 }} />
              <TextField size="small" type="number" placeholder="—" value={row.resolveHours}
                onChange={(e) => set(priority, 'resolveHours', e.target.value)} sx={{ flex: 1 }} />
            </Stack>
          )
        })}

        {message && <Alert severity="info" sx={{ mt: 2 }}>{message}</Alert>}
        <Button variant="contained" sx={{ mt: 2.5 }} disabled={save.isPending} onClick={() => save.mutate()}>
          Save SLA targets
        </Button>
      </Paper>
    </AppShell>
  )
}
