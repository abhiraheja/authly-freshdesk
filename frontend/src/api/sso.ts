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

export interface SsoDiscovery {
  workspaceSlug: string
  providerName: string
  protocol: 'oidc' | 'saml'
  startUrl: string
}

// Returns null when this installation has no SSO connection (API replies 204).
export function discoverSso() {
  return api<SsoDiscovery | undefined>('/api/public/sso/discover').then((r) => r ?? null)
}
