import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';
import type { User } from '../auth/auth.models';

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

/**
 * What the invite link's landing page may know before anyone accepts.
 *
 * `expired` and `accepted` are reported rather than hidden behind a 404, so a
 * link that has simply run out can say so instead of looking broken. The email
 * is included because the recipient needs to see which address they were invited
 * at — a link forwarded to a personal inbox still joins as the invited one.
 */
export interface InvitationInfo {
  workspaceName: string;
  workspaceSlug: string;
  email: string;
  role: string;
  invitedBy: string | null;
  expired: boolean;
  accepted: boolean;
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

  /**
   * Reads an invitation without consuming it.
   *
   * **Deliberately not swallowed like `branding()`.** There, a miss costs some
   * colour; here it is the whole page — "this link is not valid" and "we could
   * not reach the server" need different words and only one of them is worth
   * retrying, so the caller gets the `ApiError` and decides.
   */
  invitation(token: string): Promise<InvitationInfo> {
    return this.api.get<InvitationInfo>(`/api/invitations/${encodeURIComponent(token)}`);
  }

  /**
   * Consumes the invitation and signs the invitee in — the session cookie comes
   * back on this response, which is why nothing but the POST may spend the token
   * (invariant 7: mail scanners fetch the GET above).
   */
  acceptInvitation(token: string, name?: string): Promise<{ status: string; user: User }> {
    return this.api.post<{ status: string; user: User }>('/api/invitations/accept', { token, name });
  }
}
