import { api } from './client'

export interface Workspace {
  id: string
  name: string
  slug: string
}

export interface User {
  id: string
  email: string | null
  name: string | null
  role: 'customer' | 'agent' | 'admin'
  workspace: Workspace
}

// Trackly is self-hosted: one workspace. Verification used to also return
// `signup_required` (go create a workspace) and `choose_workspace` (this email
// is in several) — neither can happen now.
export type VerifyResponse = { status: 'ok'; user: User }

export function sendMagicLink(email: string, workspaceSlug?: string) {
  return api<void>('/api/auth/magic-link/send', {
    method: 'POST',
    body: JSON.stringify({ email, workspaceSlug }),
  })
}

export function verifyMagicLink(params: {
  token?: string
  email?: string
  code?: string
  workspaceSlug?: string
}) {
  return api<VerifyResponse>('/api/auth/magic-link/verify', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export function getMe() {
  return api<User>('/api/users/me')
}

export function logout() {
  return api<void>('/api/auth/logout', { method: 'POST' })
}

export function homePathFor(user: User): string {
  return user.role === 'customer' ? '/portal' : '/dashboard'
}
