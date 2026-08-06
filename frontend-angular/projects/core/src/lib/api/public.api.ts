import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

/**
 * A workspace's public branding — everything a customer-facing surface needs to
 * wear the tenant's identity instead of Trackly's.
 */
export interface PublicBranding {
  workspaceName: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  pageTitle: string;
  welcomeText: string;
  footerText: string | null;
  hidePoweredBy: boolean;
  emailLoginEnabled: boolean;
  ssoProviderName: string | null;
  categories: { id: string; name: string }[];
}

/** Unauthenticated endpoints — reachable before (and instead of) a session. */
@Injectable({ providedIn: 'root' })
export class PublicApi {
  private readonly api = inject(ApiService);

  /**
   * Branding for a workspace slug, or `null` if the slug is unknown.
   *
   * A miss must not break the page: a customer following a stale link should
   * still get a working (Trackly-branded) sign-in rather than an error screen.
   */
  async branding(slug: string): Promise<PublicBranding | null> {
    try {
      return await this.api.get<PublicBranding>(`/api/public/workspaces/${encodeURIComponent(slug)}/branding`);
    } catch {
      return null;
    }
  }
}
