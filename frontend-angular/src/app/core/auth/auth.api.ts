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

  signup(params: {
    email: string;
    token?: string;
    code?: string;
    workspaceName: string;
    workspaceSlug: string;
    name?: string;
  }): Promise<{ status: 'ok'; user: User }> {
    return this.api.post<{ status: 'ok'; user: User }>('/api/signup', params);
  }

  /** The signed-in user, or a 401 if the session cookie is missing or expired. */
  me(): Promise<User> {
    return this.api.get<User>('/api/users/me');
  }

  logout(): Promise<void> {
    return this.api.post<void>('/api/auth/logout');
  }

  /**
   * Whether an email's domain routes to a workspace's SSO.
   *
   * Returns `null` both when the API answers 204 (domain not routed) and when the
   * call fails outright — a non-answer, not an error, so the caller falls back to
   * the magic link. A discovery outage must never block sign-in.
   */
  async discoverSso(email: string): Promise<SsoDiscovery | null> {
    try {
      return (await this.api.get<SsoDiscovery | null>('/api/public/sso/discover', { email })) ?? null;
    } catch {
      return null;
    }
  }
}
