import * as signalR from '@microsoft/signalr'
import { api } from './client'

export interface ChatMessage {
  id: string
  sessionId: string
  sender: string // visitor | agent | system
  authorName: string | null
  body: string
  createdAt: string
}

export interface ChatSession {
  id: string
  visitorName: string | null
  visitorEmail: string | null
  status: string
  agentId: string | null
  agentName: string | null
  ticketId: string | null
  messageCount: number
  createdAt: string
}

export interface ChatThread {
  session: ChatSession
  messages: ChatMessage[]
}

// ---- Public (visitor) ----

export interface ChatStart {
  sessionId: string
  token: string
}

export function startChat(workspaceSlug: string, name?: string, email?: string) {
  return api<ChatStart>('/api/public/chat/start', {
    method: 'POST',
    body: JSON.stringify({ workspaceSlug, name: name || null, email: email || null }),
  })
}

export function getVisitorThread(sessionId: string, token: string) {
  return api<ChatThread>(`/api/public/chat/${sessionId}/messages?token=${encodeURIComponent(token)}`)
}

export function postVisitorMessage(sessionId: string, token: string, body: string) {
  return api<ChatMessage>(`/api/public/chat/${sessionId}/messages?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export function endVisitorChat(sessionId: string, token: string) {
  return api<{ ticketId: string }>(`/api/public/chat/${sessionId}/end?token=${encodeURIComponent(token)}`, {
    method: 'POST',
  })
}

// ---- Agent ----

export function listChatSessions() {
  return api<ChatSession[]>('/api/chat/sessions')
}

export function getAgentThread(id: string) {
  return api<ChatThread>(`/api/chat/sessions/${id}/messages`)
}

export function postAgentMessage(id: string, body: string) {
  return api<ChatMessage>(`/api/chat/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) })
}

export function endAgentChat(id: string) {
  return api<{ ticketId: string }>(`/api/chat/sessions/${id}/end`, { method: 'POST' })
}

// ---- SignalR ----

// Agents connect with no query (session cookie authenticates); visitors pass
// their sessionId + token so the hub can authorize the connection.
export function createChatConnection(query?: Record<string, string>) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  return new signalR.HubConnectionBuilder()
    .withUrl(`/hubs/chat${qs}`)
    .withAutomaticReconnect()
    .build()
}
