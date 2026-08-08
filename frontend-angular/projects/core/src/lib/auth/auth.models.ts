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
}

/**
 * Magic-link verification either signs you in or fails.
 *
 * It used to have two more outcomes — `signup_required` (build a workspace) and
 * `choose_workspace` (this email is in several). A self-hosted install has one
 * workspace, so there is nothing to create and nothing to choose between.
 */
export type VerifyResponse = { status: 'ok'; user: User };

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
