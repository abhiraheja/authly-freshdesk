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

export interface WorkspaceSummary {
  slug: string
  name: string
}

export type VerifyResponse =
  | { status: 'ok'; user: User }
  | { status: 'signup_required'; email: string }
  | { status: 'choose_workspace'; email: string; workspaces: WorkspaceSummary[] }

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

export function signup(params: {
  email: string
  token?: string
  code?: string
  workspaceName: string
  workspaceSlug: string
  name?: string
}) {
  return api<{ status: 'ok'; user: User }>('/api/signup', {
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
