import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiError } from '../api/api-error';
import { AuthApi } from './auth.api';
import type { User, UserRole } from './auth.models';

/**
 * The signed-in user, and the single source of truth for role checks.
 *
 * Roles come from Trackly's own database via `/api/users/me` — never decoded from
 * an IdP token in the browser (invariant 2). An external IdP only proves who the
 * person is; what they may do is Trackly's answer.
 *
 * The client-side role signals below drive *navigation and affordances only*.
 * Every endpoint re-checks server-side; hiding a button is never the control.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly auth = inject(AuthApi);

  private readonly _user = signal<User | null>(null);
  private readonly _loaded = signal(false);

  /** In-flight `/me` request, so concurrent guards resolve one call, not N. */
  private pending: Promise<User | null> | null = null;

  readonly user = this._user.asReadonly();
  /** True once the session has been resolved at least once (success or 401). */
  readonly loaded = this._loaded.asReadonly();

  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly role = computed<UserRole | null>(() => this._user()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly isAgent = computed(() => this.role() === 'agent' || this.role() === 'admin');
  readonly isCustomer = computed(() => this.role() === 'customer');
  readonly workspace = computed(() => this._user()?.workspace ?? null);

  /** Display name with a sensible fallback chain. */
  readonly displayName = computed(() => {
    const user = this._user();
    return user?.name ?? user?.email ?? 'Account';
  });

  /**
   * Resolves the session, fetching it once and caching the result.
   *
   * A 401 is the normal signed-out answer, not a failure — it resolves to `null`.
   * Anything else (server down, network) also resolves to `null` but leaves the
   * cache unset, so the next navigation retries instead of pinning the user to
   * the login page because of a blip.
   */
  ensureLoaded(): Promise<User | null> {
    if (this._loaded()) return Promise.resolve(this._user());
    return (this.pending ??= this.load());
  }

  private async load(): Promise<User | null> {
    try {
      const user = await this.auth.me();
      this.set(user);
      return user;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        this._user.set(null);
        this._loaded.set(true);
      }
      // Transient failure: leave `_loaded` false so a later navigation retries.
      return null;
    } finally {
      this.pending = null;
    }
  }

  /** Adopts a user returned by verify/signup, skipping the extra `/me` round-trip. */
  set(user: User): void {
    this._user.set(user);
    this._loaded.set(true);
    this.pending = null;
  }

  /** Signs out server-side, then clears local state regardless of the outcome. */
  async signOut(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      this.clear();
    }
  }

  /** Drops the cached session so the next `ensureLoaded()` refetches. */
  clear(): void {
    this._user.set(null);
    this._loaded.set(false);
    this.pending = null;
  }
}
