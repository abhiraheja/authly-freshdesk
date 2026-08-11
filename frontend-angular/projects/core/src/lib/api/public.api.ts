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
  /** Artwork for the panel beside the sign-in form. Null keeps the built-in. */
  signInImageUrl: string | null;
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
   * Branding for a workspace slug — or, with no slug, for the installation's own
   * workspace.
   *
   * **The slug is optional on purpose.** The sign-in page has none to offer,
   * while the verify page it hands off to is reached from an email that carries
   * `?workspace=`. When this required a slug, that difference showed up as two
   * different-looking screens in one sign-in. One deployment holds one
   * workspace, so the server can always resolve it (invariant 1).
   *
   * A miss must not break the page: someone following a stale link should still
   * get a working, if unbranded, sign-in rather than an error screen.
   */
  async branding(slug?: string): Promise<PublicBranding | null> {
    const path = slug
      ? `/api/public/workspaces/${encodeURIComponent(slug)}/branding`
      : '/api/public/branding';
    try {
      return await this.api.get<PublicBranding>(path);
    } catch {
      return null;
    }
  }
}
