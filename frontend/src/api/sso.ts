import { api } from './client'

// Admin SSO configuration moved to the Angular app (`@trackly/core`'s SsoApi)
// when a workspace gained more than one provider. The CRUD helpers that used to
// live here spoke the old single-connection shape — PUT/DELETE /api/admin/sso
// with no id — and those routes no longer exist.
//
// What remains is the one call the retiring React sign-in page still makes.

export interface SsoDiscovery {
  workspaceSlug: string
  providerName: string
  protocol: 'oidc' | 'saml' | 'oauth2'
  startUrl: string
}

// Returns null when this installation has no SSO connection (API replies 204).
// With several configured, this reports the first one shown on staff sign-in.
export function discoverSso() {
  return api<SsoDiscovery | undefined>('/api/public/sso/discover').then((r) => r ?? null)
}
