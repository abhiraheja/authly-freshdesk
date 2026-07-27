import { api } from './client'

// ---- Public (token-authenticated rating surface) ----

export interface CsatView {
  workspaceSlug: string
  ticketRef: string
  subject: string
  rating: number | null
  submitted: boolean
}

export function getCsat(ticketId: string, token: string) {
  return api<CsatView>(`/api/public/csat/${ticketId}?token=${encodeURIComponent(token)}`)
}

export function submitCsat(ticketId: string, token: string, rating: number, comment: string) {
  return api<void>(`/api/public/csat/${ticketId}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ rating, comment: comment.trim() || null }),
  })
}

// ---- Agent-facing ----

export interface CsatResult {
  rating: number | null
  comment: string | null
  submitted: boolean
}

// Returns undefined (204) when no survey has been issued for the ticket.
export function getTicketCsat(ticketId: string) {
  return api<CsatResult | undefined>(`/api/tickets/${ticketId}/csat`)
}
