import { api } from './client'
import type { TicketSummary, UserSummary } from './tickets'

export interface ProblemSummary {
  id: string
  title: string
  status: string
  assignee: UserSummary | null
  ticketCount: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface ProblemDetail {
  id: string
  title: string
  description: string | null
  status: string
  assignee: UserSummary | null
  createdBy: UserSummary | null
  tickets: TicketSummary[]
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export const PROBLEM_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const

export function listProblems() {
  return api<ProblemSummary[]>('/api/problems')
}

export function getProblem(id: string) {
  return api<ProblemDetail>(`/api/problems/${id}`)
}

export function createProblem(body: { title: string; description?: string; assigneeId?: string }) {
  return api<ProblemDetail>('/api/problems', { method: 'POST', body: JSON.stringify(body) })
}

export function updateProblem(
  id: string,
  body: { title?: string; description?: string; status?: string; assigneeId?: string; unassign?: boolean },
) {
  return api<ProblemDetail>(`/api/problems/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function linkTicket(problemId: string, ticketId: string) {
  return api<void>(`/api/problems/${problemId}/tickets`, { method: 'POST', body: JSON.stringify({ ticketId }) })
}

export function unlinkTicket(ticketId: string) {
  return api<void>(`/api/problems/tickets/${ticketId}`, { method: 'DELETE' })
}

export function resolveProblem(id: string, bulkResolveTickets = true) {
  return api<ProblemDetail>(`/api/problems/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ bulkResolveTickets }),
  })
}
