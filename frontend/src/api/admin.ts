import { api } from './client'
import type { User } from './auth'

export interface AdminBranding {
  hasLogo: boolean
  primaryColor: string
  pageTitle: string | null
  welcomeText: string | null
  footerText: string | null
  hidePoweredBy: boolean
}

export function getAdminBranding() {
  return api<AdminBranding>('/api/admin/branding')
}

export function saveAdminBranding(body: Partial<AdminBranding>) {
  return api<AdminBranding>('/api/admin/branding', { method: 'PUT', body: JSON.stringify(body) })
}

export async function uploadLogo(file: File) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch('/api/admin/branding/logo', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? 'Logo upload failed')
  }
  return (await response.json()) as AdminBranding
}

export interface Member {
  id: string
  name: string | null
  email: string | null
  role: string
}

export function listMembers() {
  return api<Member[]>('/api/users')
}

export function updateMember(id: string, body: { role?: string; isActive?: boolean }) {
  return api<Member & { isActive: boolean }>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export interface Invitation {
  id: string
  email: string
  role: string
  invitedBy: string | null
  expiresAt: string
  acceptedAt: string | null
}

export function listInvitations() {
  return api<Invitation[]>('/api/invitations')
}

export function createInvitation(email: string, role: string) {
  return api<Invitation>('/api/invitations', { method: 'POST', body: JSON.stringify({ email, role }) })
}

export function revokeInvitation(id: string) {
  return api<void>(`/api/invitations/${id}`, { method: 'DELETE' })
}

export interface InvitationInfo {
  workspaceName: string
  workspaceSlug: string
  email: string
  role: string
  invitedBy: string | null
  expired: boolean
  accepted: boolean
}

export function getInvitationInfo(token: string) {
  return api<InvitationInfo>(`/api/invitations/${encodeURIComponent(token)}`)
}

export function acceptInvitation(token: string, name?: string) {
  return api<{ status: string; user: User }>('/api/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token, name }),
  })
}
