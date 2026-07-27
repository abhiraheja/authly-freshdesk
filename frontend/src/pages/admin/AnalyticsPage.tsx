import {
  Box,
  CircularProgress,
  MenuItem,
  Paper,
  Rating,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { getAnalytics, type AnalyticsOverview, type LabeledCount } from '../../api/analytics'
import { AppShell } from '../../components/AppShell'
import { shadows } from '../../theme'

function formatMinutes(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${Math.round(m)}m`
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`
  return `${(m / (60 * 24)).toFixed(1)}d`
}

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2.25, boxShadow: shadows.soft, flex: 1, minWidth: 150 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '.6px' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 800, mt: 0.5 }}>{value}</Typography>
      {hint && <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>{hint}</Typography>}
    </Paper>
  )
}

function VolumeChart({ data }: { data: AnalyticsOverview['volume'] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2.5, boxShadow: shadows.soft }}>
      <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 2 }}>Tickets created per day</Typography>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 140 }}>
        {data.map((d) => (
          <Box
            key={d.date}
            title={`${d.date}: ${d.count}`}
            sx={{
              flex: 1,
              minWidth: 2,
              height: `${(d.count / max) * 100}%`,
              minHeight: d.count > 0 ? 3 : 0,
              bgcolor: 'primary.main',
              borderRadius: '3px 3px 0 0',
              opacity: 0.85,
            }}
          />
        ))}
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1 }}>
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{data[0]?.date}</Typography>
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{data[data.length - 1]?.date}</Typography>
      </Stack>
    </Paper>
  )
}

function Distribution({ title, rows }: { title: string; rows: LabeledCount[] }) {
  const total = Math.max(1, rows.reduce((s, r) => s + r.count, 0))
  return (
    <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2.5, boxShadow: shadows.soft, flex: 1, minWidth: 240 }}>
      <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 2 }}>{title}</Typography>
      {rows.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No data in this window.</Typography>
      ) : (
        <Stack spacing={1.25}>
          {rows.map((r) => (
            <Box key={r.label}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.4 }}>
                <Typography sx={{ fontSize: 13, textTransform: 'capitalize' }}>{r.label}</Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{r.count}</Typography>
              </Stack>
              <Box sx={{ height: 7, borderRadius: 4, bgcolor: 'action.hover' }}>
                <Box sx={{ width: `${(r.count / total) * 100}%`, height: '100%', borderRadius: 4, bgcolor: 'primary.main' }} />
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  )
}

export function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const query = useQuery({ queryKey: ['analytics', days], queryFn: () => getAnalytics(days) })
  const a = query.data

  return (
    <AppShell>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5">Analytics</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>
            Workspace performance over the selected window.
          </Typography>
        </Box>
        <TextField select size="small" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ minWidth: 150 }}>
          <MenuItem value={7}>Last 7 days</MenuItem>
          <MenuItem value={30}>Last 30 days</MenuItem>
          <MenuItem value={90}>Last 90 days</MenuItem>
        </TextField>
      </Stack>

      {query.isPending || !a ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
            <StatCard label="Created" value={String(a.createdInWindow)} hint={`in ${a.days} days`} />
            <StatCard label="Resolved" value={String(a.resolvedInWindow)} hint={`in ${a.days} days`} />
            <StatCard label="Avg first response" value={formatMinutes(a.avgFirstResponseMinutes)} />
            <StatCard label="Avg resolution" value={formatMinutes(a.avgResolutionMinutes)} />
          </Stack>

          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
            <StatCard label="First-response SLA" value={pct(a.firstResponseSlaAttainment)} hint="met on time" />
            <StatCard label="Resolution SLA" value={pct(a.resolutionSlaAttainment)} hint="met on time" />
            <StatCard
              label="CSAT"
              value={a.avgCsat != null ? `${a.avgCsat.toFixed(2)} / 5` : '—'}
              hint={`${a.csatResponses} ${a.csatResponses === 1 ? 'response' : 'responses'}`}
            />
          </Stack>

          <VolumeChart data={a.volume} />

          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
            <Distribution title="By channel" rows={a.byChannel} />
            <Distribution title="By status" rows={a.byStatus} />
          </Stack>

          <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2.5, boxShadow: shadows.soft, overflowX: 'auto' }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1.5 }}>Agent leaderboard</Typography>
            {a.leaderboard.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No agent activity in this window.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Agent</TableCell>
                    <TableCell align="right">Resolved</TableCell>
                    <TableCell align="right">Avg first response</TableCell>
                    <TableCell align="right">Avg resolution</TableCell>
                    <TableCell align="right">CSAT</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {a.leaderboard.map((r) => (
                    <TableRow key={r.agentId}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell align="right">{r.resolved}</TableCell>
                      <TableCell align="right">{formatMinutes(r.avgFirstResponseMinutes)}</TableCell>
                      <TableCell align="right">{formatMinutes(r.avgResolutionMinutes)}</TableCell>
                      <TableCell align="right">
                        {r.avgCsat != null ? (
                          <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                            <Rating value={r.avgCsat} precision={0.1} max={5} readOnly size="small" />
                            <Typography sx={{ fontSize: 12.5 }}>{r.avgCsat.toFixed(1)}</Typography>
                          </Stack>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>
        </Stack>
      )}
    </AppShell>
  )
}
