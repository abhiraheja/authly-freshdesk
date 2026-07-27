import { api } from './client'

export interface AiSettings {
  enabled: boolean
  configured: boolean // deployment-level API key present
}

export function getAiSettings() {
  return api<AiSettings>('/api/admin/ai')
}

export function setAiEnabled(enabled: boolean) {
  return api<AiSettings>('/api/admin/ai', { method: 'PUT', body: JSON.stringify({ enabled }) })
}

// Agent-facing: is the copilot usable here (deployment key + workspace toggle)?
export function getAiAvailability() {
  return api<{ available: boolean }>('/api/ai/available')
}

// AI suggestions on a ticket. Both return text the agent reviews before use —
// nothing is ever sent to the customer automatically.
export function draftReply(ticketId: string) {
  return api<{ draft: string }>(`/api/tickets/${ticketId}/ai/draft-reply`, { method: 'POST' })
}

export function summarizeTicket(ticketId: string) {
  return api<{ summary: string }>(`/api/tickets/${ticketId}/ai/summary`, { method: 'POST' })
}
