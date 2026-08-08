export type UserRole = 'customer' | 'agent' | 'admin';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  /** API path to their photo, or null for the initials fallback. */
  avatarUrl: string | null;
  workspace: Workspace;
  /**
   * They are on a temporary password an admin handed them. Route to the
   * change-password screen — but note the API enforces this independently, so
   * ignoring the flag produces 403s rather than access.
   */
  mustChangePassword: boolean;
}

/**
 * Magic-link verification either signs you in or fails.
 *
 * It used to have two more outcomes — `signup_required` (build a workspace) and
 * `choose_workspace` (this email is in several). A self-hosted install has one
 * workspace, so there is nothing to create and nothing to choose between.
 */
export type VerifyResponse = { status: 'ok'; user: User };

/** What the sign-in page should offer. Read before anyone has signed in. */
export interface LoginMethods {
  /** No workspace exists yet — the visitor belongs on /setup. */
  needsSetup: boolean;
  passwordLoginEnabled: boolean;
  emailLoginEnabled: boolean;
  sso: { providerName: string; protocol: 'oidc' | 'saml'; startUrl: string } | null;
}

/** This installation's SSO entry point, if one is configured. */
export interface SsoDiscovery {
  workspaceSlug: string;
  providerName: string;
  protocol: 'oidc' | 'saml';
  startUrl: string;
}

/** Where a signed-in user belongs after auth completes. */
export function homePathFor(user: User): string {
  return user.role === 'customer' ? '/portal' : '/dashboard';
}
