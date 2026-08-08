import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';
import type { UserRole } from '../auth/auth.models';

/**
 * The provider *kind*. It selects endpoints, claim shapes and the brand mark —
 * it is not the button's label, which an admin can rename.
 *
 * A string union rather than a lookup on the server's list, because every
 * per-provider branch in the UI (which fields, which mark, which help text) has
 * to be exhaustive, and the compiler is what makes it so.
 */
export type SsoProviderKind = 'google' | 'microsoft' | 'facebook' | 'authly' | 'oidc' | 'saml';

/** OAuth 2.0 is Facebook's, and only Facebook's — see the server's catalogue. */
export type SsoProtocol = 'oidc' | 'saml' | 'oauth2';

export type SsoStatus = 'pending' | 'active' | 'error';

/**
 * What Trackly already knows about one provider, sent by the server so the
 * screen does not keep a second copy of the same facts.
 */
export interface SsoCatalogueEntry {
  readonly provider: SsoProviderKind;
  readonly displayName: string;
  readonly protocol: SsoProtocol;
  /** The admin has to supply the URL — the IdP lives on their own domain. */
  readonly needsDiscoveryEndpoint: boolean;
  /**
   * Set when the admin gives a **base URL** and Trackly appends this to reach
   * discovery — e.g. `/.well-known/openid-configuration`. Null means they type
   * the discovery URL in full.
   */
  readonly discoverySuffix: string | null;
  /** Entra builds its discovery URL from one; Authly sends one on authorize. */
  readonly needsTenant: boolean;
  /**
   * The tenant is a workspace slug sent with the sign-in request, not a
   * directory id inside a URL — a different question, asked differently.
   */
  readonly tenantIsSlug: boolean;
  readonly defaultTenant: string | null;
  readonly requiresClientSecret: boolean;
  /** The IdP can send group claims, so group→role mapping is worth offering. */
  readonly supportsGroups: boolean;
  readonly defaultScopes: string;
  /** Where the admin creates the app and finds the client id. */
  readonly setupDocsUrl: string | null;
  /** Configurable more than once — two corporate IdPs is a real setup. */
  readonly repeatable: boolean;
}

export interface SsoGroupMapping {
  groupName: string;
  tracklyRole: UserRole;
}

/**
 * One configured provider. Secrets are never returned — `hasClientSecret` is
 * all the server will say (invariant 3).
 */
export interface SsoConnection {
  readonly id: string;
  readonly provider: SsoProviderKind;
  /** The button label. Defaults to the provider's name; an admin may rename it. */
  readonly providerName: string;
  readonly protocol: SsoProtocol;
  readonly discoveryEndpoint: string | null;
  /** With the tenant substituted in — what will actually be called. */
  readonly resolvedDiscoveryEndpoint: string | null;
  readonly clientId: string | null;
  readonly hasClientSecret: boolean;
  readonly tenant: string | null;
  readonly scopes: string | null;
  readonly allowedEmailDomains: string | null;
  readonly idpMetadataUrl: string | null;
  readonly idpMetadataXml: string | null;
  readonly spEntityId: string | null;
  /** The SP metadata URL to hand the IdP. SAML only. */
  readonly spMetadataUrl: string | null;
  readonly isEnabled: boolean;
  readonly showOnStaffLogin: boolean;
  readonly showOnCustomerLogin: boolean;
  readonly sortOrder: number;
  /** `active` only after a real login completed — that is what invariant 8 counts. */
  readonly status: SsoStatus;
  readonly testedAt: string | null;
  readonly startUrl: string;
  readonly groupMappings: SsoGroupMapping[];
}

export interface SsoSettings {
  readonly catalogue: SsoCatalogueEntry[];
  /** One URL for every OIDC and OAuth 2.0 provider. Register it at the IdP. */
  readonly redirectUri: string;
  readonly samlAcsUrl: string;
  readonly connections: SsoConnection[];
}

/**
 * A save. `clientSecret` follows the same three-way rule as every other secret
 * in Trackly: omitted keeps what is stored, `''` clears it, anything else
 * replaces it — which is what lets the form round-trip a value it has never seen.
 */
export interface SsoConnectionBody {
  provider?: SsoProviderKind;
  providerName?: string;
  discoveryEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  tenant?: string;
  scopes?: string;
  allowedEmailDomains?: string;
  idpMetadataUrl?: string;
  idpMetadataXml?: string;
  spEntityId?: string;
  isEnabled?: boolean;
  showOnStaffLogin?: boolean;
  showOnCustomerLogin?: boolean;
  sortOrder?: number;
  groupMappings?: SsoGroupMapping[];
}

/**
 * Admin → Single sign-on.
 *
 * A workspace holds a *list* of providers, so every call carries a connection
 * id. There is deliberately no "test" endpoint: an SSO flow signs you in, so the
 * only honest test is to walk through it — the screen sends the admin to
 * `startUrl` in a private window instead of claiming a green tick.
 */
@Injectable({ providedIn: 'root' })
export class SsoApi {
  private readonly api = inject(ApiService);

  settings(): Promise<SsoSettings> {
    return this.api.get<SsoSettings>('/api/admin/sso');
  }

  create(body: SsoConnectionBody): Promise<SsoConnection> {
    return this.api.post<SsoConnection>('/api/admin/sso', body);
  }

  /** A full save. Every field is sent; anything absent is treated as cleared. */
  update(id: string, body: SsoConnectionBody): Promise<SsoConnection> {
    return this.api.put<SsoConnection>(`/api/admin/sso/${id}`, body);
  }

  /**
   * Just the switches. Separate from `update` because that is a full save and
   * validates the whole connection — flipping a row's toggle through it would
   * clear every field the toggle did not send.
   */
  setState(
    id: string,
    body: { isEnabled?: boolean; showOnStaffLogin?: boolean; showOnCustomerLogin?: boolean; sortOrder?: number },
  ): Promise<SsoConnection> {
    return this.api.patch<SsoConnection>(`/api/admin/sso/${id}`, body);
  }

  remove(id: string): Promise<void> {
    return this.api.delete<void>(`/api/admin/sso/${id}`);
  }
}
