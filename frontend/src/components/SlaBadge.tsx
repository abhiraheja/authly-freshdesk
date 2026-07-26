import { Chip } from '@mui/material'
import type { TicketDetail, TicketSummary } from '../api/tickets'

const TONE = {
  met: { bg: '#DCFCE7', fg: '#15803D' },
  ok: { bg: '#DCFCE7', fg: '#15803D' },
  soon: { bg: '#FEF3C7', fg: '#B45309' },
  overdue: { bg: '#FEE2E2', fg: '#B91C1C' },
} as const

function remainingLabel(dueAt: string): { tone: keyof typeof TONE; label: string } {
  const ms = new Date(dueAt).getTime() - Date.now()
  const mins = Math.round(ms / 60000)
  if (mins < 0) return { tone: 'overdue', label: `overdue ${fmt(-mins)}` }
  return { tone: mins <= 60 ? 'soon' : 'ok', label: `in ${fmt(mins)}` }
}

function fmt(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// The most-urgent SLA state for a ticket: unmet first response wins over resolve;
// resolved/closed tickets have no active clock. Returns null when no SLA applies.
export function slaState(ticket: Pick<TicketSummary, 'status' | 'firstResponseDueAt' | 'resolveDueAt' | 'firstResponseAt'>) {
  if (ticket.firstResponseDueAt && !ticket.firstResponseAt) {
    const r = remainingLabel(ticket.firstResponseDueAt)
    return { ...r, prefix: 'Response' }
  }
  if (ticket.resolveDueAt && ticket.status !== 'resolved' && ticket.status !== 'closed') {
    const r = remainingLabel(ticket.resolveDueAt)
    return { ...r, prefix: 'Resolve' }
  }
  return null
}

export function SlaBadge({ ticket, showPrefix = false }: { ticket: TicketSummary | TicketDetail; showPrefix?: boolean }) {
  const state = slaState(ticket)
  if (!state) return null
  const tone = TONE[state.tone]
  return (
    <Chip
      label={showPrefix ? `${state.prefix} ${state.label}` : state.label}
      size="small"
      sx={{ height: 20, fontSize: 11, fontWeight: 600, bgcolor: tone.bg, color: tone.fg }}
    />
  )
}
