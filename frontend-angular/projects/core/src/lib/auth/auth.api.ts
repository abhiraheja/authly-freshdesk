import { Injectable, inject } from '@angular/core';
import { ApiService } from '../api/api.service';
import type { SsoDiscovery, User, VerifyResponse } from './auth.models';

/**
 * Passwordless auth. Trackly has no password endpoint and never will — the only
 * ways in are a magic link + 6-digit code, or a workspace's configured SSO.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiService);

  /** Emails a sign-in link and a 6-digit code. `workspaceSlug` scopes it to one workspace. */
  sendMagicLink(email: string, workspaceSlug?: string): Promise<void> {
    return this.api.post<void>('/api/auth/magic-link/send', { email, workspaceSlug });
  }

  /**
   * Consumes a magic-link token OR an emailed code.
   *
   * Called only from a confirm action — never on page load. Email scanners
   * prefetch GET links, so a verify page that consumed the token while rendering
   * would burn it before the user clicked (invariant 7).
   */
  verify(params: {
    token?: string;
    email?: string;
    code?: string;
    workspaceSlug?: string;
  }): Promise<VerifyResponse> {
    return this.api.post<VerifyResponse>('/api/auth/magic-link/verify', params);
  }

  /** Whether this installation still needs its first-run setup. */
  async needsSetup(): Promise<boolean> {
    try {
      return (await this.api.get<{ needsSetup: boolean }>('/api/setup/status')).needsSetup;
    } catch {
      // An unreachable API is not the same as an unclaimed installation, and
      // guessing "yes" would offer to hand the whole thing to a stranger.
      return false;
    }
  }

  /**
   * Claims an empty installation: creates the workspace and its first admin, and
   * signs them in there and then.
   *
   * No email round trip on purpose — SMTP is configured from inside the admin UI,
   * so on a fresh install there is no way to deliver a link yet.
   */
  setup(params: { organisationName: string; email: string; name?: string }): Promise<{ user: User }> {
    return this.api.post<{ user: User }>('/api/setup', params);
  }

  /** The signed-in user, or a 401 if the session cookie is missing or expired. */
  me(): Promise<User> {
    return this.api.get<User>('/api/users/me');
  }

  logout(): Promise<void> {
    return this.api.post<void>('/api/auth/logout');
  }

  /**
   * Whether this installation has SSO configured, and where to start it.
   *
   * Returns `null` both when the API answers 204 (no connection) and when the
   * call fails outright — a non-answer, not an error, so the caller falls back to
   * the magic link. An SSO outage must never block sign-in.
   */
  async discoverSso(): Promise<SsoDiscovery | null> {
    try {
      return (await this.api.get<SsoDiscovery | null>('/api/public/sso/discover')) ?? null;
    } catch {
      return null;
    }
  }
}
