import { api } from './client'

export interface GroupMapping {
  groupName: string
  tracklyRole: string
}

export interface SsoConnection {
  providerName: string
  protocol: 'oidc' | 'saml'
  discoveryEndpoint: string | null
  clientId: string | null
  hasClientSecret: boolean
  idpMetadataUrl: string | null
  idpMetadataXml: string | null
  spEntityId: string | null
  status: string
  testedAt: string | null
  groupMappings: GroupMapping[]
}

export interface SaveSsoBody {
  providerName: string
  protocol: 'oidc' | 'saml'
  discoveryEndpoint?: string | null
  clientId?: string | null
  clientSecret?: string | null // null keeps, "" clears, value sets
  idpMetadataUrl?: string | null
  idpMetadataXml?: string | null
  spEntityId?: string | null
  groupMappings: GroupMapping[]
}

export function getSso() {
  return api<SsoConnection | null>('/api/admin/sso')
}

export function saveSso(body: SaveSsoBody) {
  return api<SsoConnection>('/api/admin/sso', { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteSso() {
  return api<void>('/api/admin/sso', { method: 'DELETE' })
}

export interface WorkspaceDomain {
  id: string
  domain: string
  verified: boolean
  discoverable: boolean
  verifiedAt: string | null
  txtRecordName: string
  txtRecordValue: string
}

export function listDomains() {
  return api<WorkspaceDomain[]>('/api/admin/domains')
}

export function addDomain(domain: string) {
  return api<WorkspaceDomain>('/api/admin/domains', { method: 'POST', body: JSON.stringify({ domain }) })
}

export interface VerifyResult extends Partial<WorkspaceDomain> {
  verified: boolean
  expectedTxt?: string
  found?: string[]
}

export function verifyDomain(id: string) {
  return api<VerifyResult>(`/api/admin/domains/${id}/verify`, { method: 'POST' })
}

export function setDiscoverable(id: string, discoverable: boolean) {
  return api<WorkspaceDomain>(`/api/admin/domains/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ discoverable }),
  })
}

export function deleteDomain(id: string) {
  return api<void>(`/api/admin/domains/${id}`, { method: 'DELETE' })
}

export interface SsoDiscovery {
  workspaceSlug: string
  providerName: string
  protocol: 'oidc' | 'saml'
  startUrl: string
}

// Returns null when the email domain isn't routed to SSO (API replies 204).
export function discoverSso(email: string) {
  return api<SsoDiscovery | undefined>(`/api/public/sso/discover?email=${encodeURIComponent(email)}`).then(
    (r) => r ?? null,
  )
}
