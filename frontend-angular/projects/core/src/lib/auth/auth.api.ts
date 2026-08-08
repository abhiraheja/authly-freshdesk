import { Injectable, inject } from '@angular/core';
import { ApiService } from '../api/api.service';
import type { LoginMethods, SsoDiscovery, User, VerifyResponse } from './auth.models';

/**
 * Three ways in: email + password, an emailed link/6-digit code, or SSO.
 *
 * Password is the primary one on a self-hosted install, because the other two
 * cannot work on a fresh database — SMTP and SSO are both configured from
 * inside Trackly. An admin may turn passwords off later, but only once email or
 * SSO is proven to work (see LoginSettingsController).
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiService);

  /**
   * Which sign-in methods this installation offers.
   *
   * Falls back to "password and email, no SSO" if the call fails: the sign-in
   * page must still render something usable when the API is having a bad moment,
   * and offering a method that turns out to be off is a clear error message —
   * offering nothing is a dead end.
   */
  async loginMethods(workspaceSlug?: string): Promise<LoginMethods> {
    try {
      return await this.api.get<LoginMethods>(
        '/api/public/login-methods',
        workspaceSlug ? { workspace: workspaceSlug } : undefined,
      );
    } catch {
      return {
        needsSetup: false,
        passwordLoginEnabled: true,
        emailLoginEnabled: true,
        sso: null,
        ssoProviders: [],
      };
    }
  }

  /**
   * Email + password.
   *
   * The primary way in on a self-hosted install: it is the only credential that
   * works before SMTP is configured, and SMTP is configured from inside Trackly.
   */
  passwordLogin(params: { email: string; password: string; workspaceSlug?: string }): Promise<{ user: User }> {
    return this.api.post<{ user: User }>('/api/auth/password/login', params);
  }

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.api.post<void>('/api/auth/password/change', { currentPassword, newPassword });
  }

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
  setup(params: {
    organisationName: string;
    email: string;
    password: string;
    name?: string;
  }): Promise<{ user: User }> {
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
