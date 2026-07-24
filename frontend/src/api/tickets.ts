import { api } from './client'

export interface Category {
  id: string
  name: string
  color: string | null
}

export interface UserSummary {
  id: string
  name: string | null
  email: string | null
  role: string
}

export interface TicketSummary {
  id: string
  subject: string
  status: string
  priority: string
  channel: string
  category: Category | null
  requester: UserSummary | null
  guestName: string | null
  guestEmail: string | null
  assignee: UserSummary | null
  commentCount: number
  createdAt: string
  updatedAt: string
}

export interface Watcher {
  agent: UserSummary
  addedAt: string
}

export interface TicketDetail extends Omit<TicketSummary, 'commentCount'> {
  description: string
  watchers: Watcher[]
  problemId: string | null
}

export interface Attachment {
  id: string
  commentId: string | null
  fileName: string
  contentType: string
  sizeBytes: number
  createdAt: string
}

export interface Comment {
  id: string
  author: UserSummary | null
  guestEmail: string | null
  body: string
  isInternal: boolean
  source: string
  attachments: Attachment[]
  createdAt: string
}

export interface DashboardStats {
  total: number
  open: number
  pending: number
  resolved: number
  closed: number
  unassigned: number
  assignedToMe: number
  openProblems: number
}

export function getDashboardStats() {
  return api<DashboardStats>('/api/dashboard/stats')
}

export interface TicketListParams {
  status?: string
  priority?: string
  assigneeId?: string
  search?: string
  page?: number
  pageSize?: number
}

export function listTickets(params: TicketListParams = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value))
  })
  const qs = query.toString()
  return api<{ items: TicketSummary[]; total: number }>(`/api/tickets${qs ? `?${qs}` : ''}`)
}

export function getTicket(id: string) {
  return api<TicketDetail>(`/api/tickets/${id}`)
}

export function createTicket(body: {
  subject: string
  description: string
  categoryId?: string
  priority?: string
}) {
  return api<TicketDetail>('/api/tickets', { method: 'POST', body: JSON.stringify(body) })
}

export interface UpdateTicketBody {
  subject?: string
  status?: string
  priority?: string
  categoryId?: string
  clearCategory?: boolean
  assigneeId?: string
  unassign?: boolean
}

export function updateTicket(id: string, body: UpdateTicketBody) {
  return api<TicketDetail>(`/api/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function listComments(ticketId: string) {
  return api<Comment[]>(`/api/tickets/${ticketId}/comments`)
}

export function addComment(ticketId: string, body: { body: string; isInternal: boolean }) {
  return api<Comment>(`/api/tickets/${ticketId}/comments`, { method: 'POST', body: JSON.stringify(body) })
}

export function addWatcher(ticketId: string, agentId: string) {
  return api<void>(`/api/tickets/${ticketId}/watchers/${agentId}`, { method: 'PUT' })
}

export function removeWatcher(ticketId: string, agentId: string) {
  return api<void>(`/api/tickets/${ticketId}/watchers/${agentId}`, { method: 'DELETE' })
}

export function listCategories() {
  return api<Category[]>('/api/categories')
}

export function listAgents() {
  return api<UserSummary[]>('/api/users?role=agent')
}

export function listTicketAttachments(ticketId: string) {
  return api<Attachment[]>(`/api/tickets/${ticketId}/attachments`)
}

export async function uploadAttachment(ticketId: string, file: File, commentId?: string) {
  const form = new FormData()
  form.append('file', file)
  const qs = commentId ? `?commentId=${commentId}` : ''
  const response = await fetch(`/api/tickets/${ticketId}/attachments${qs}`, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error('Attachment upload failed')
  return (await response.json()) as Attachment
}

export function attachmentUrl(id: string) {
  return `/api/attachments/${id}`
}
