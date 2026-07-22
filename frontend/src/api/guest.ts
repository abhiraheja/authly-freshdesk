import { api } from './client'
import type { Attachment, Category, Comment } from './tickets'

export interface PublicBranding {
  workspaceName: string
  slug: string
  logoUrl: string | null
  primaryColor: string
  pageTitle: string
  welcomeText: string
  footerText: string | null
  hidePoweredBy: boolean
  emailLoginEnabled: boolean
  ssoProviderName: string | null
  categories: { id: string; name: string }[]
}

export function getPublicBranding(slug: string) {
  return api<PublicBranding>(`/api/public/workspaces/${slug}/branding`)
}

export function sendGuestOtp(email: string, workspaceSlug: string) {
  return api<void>('/api/guest/otp/send', {
    method: 'POST',
    body: JSON.stringify({ email, workspaceSlug }),
  })
}

export function verifyGuestOtp(email: string, code: string, workspaceSlug: string) {
  return api<{ submissionToken: string }>('/api/guest/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code, workspaceSlug }),
  })
}

export interface GuestTicketCreated {
  ticketId: string
  reference: string
  guestToken: string
}

export function createGuestTicket(
  workspaceSlug: string,
  body: { submissionToken: string; name: string; subject: string; description: string; categoryId?: string },
) {
  return api<GuestTicketCreated>(`/api/tickets/guest?workspace=${workspaceSlug}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export interface GuestTicketView {
  id: string
  reference: string
  subject: string
  description: string
  status: string
  category: Category | null
  guestName: string
  guestEmail: string
  comments: Comment[]
  ticketAttachments: Attachment[]
  createdAt: string
  updatedAt: string
}

export function getGuestTicket(id: string, token: string) {
  return api<GuestTicketView>(`/api/tickets/guest/${id}?token=${encodeURIComponent(token)}`)
}

export function addGuestComment(id: string, token: string, body: string) {
  return api<Comment>(`/api/tickets/guest/${id}/comments?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export async function uploadGuestAttachment(ticketId: string, token: string, file: File, commentId?: string) {
  const params = new URLSearchParams({ token })
  if (commentId) params.set('commentId', commentId)
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`/api/tickets/guest/${ticketId}/attachments?${params}`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) throw new Error('Attachment upload failed')
  return (await response.json()) as Attachment
}

export function guestAttachmentUrl(id: string, token: string) {
  return `/api/guest/attachments/${id}?token=${encodeURIComponent(token)}`
}
