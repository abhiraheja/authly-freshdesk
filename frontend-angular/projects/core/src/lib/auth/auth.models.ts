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
  workspace: Workspace;
}

export interface WorkspaceSummary {
  slug: string;
  name: string;
}

/**
 * Magic-link verification has three outcomes, not two:
 * - `ok` — signed in
 * - `signup_required` — the email is unknown; continue to workspace creation
 * - `choose_workspace` — the email belongs to more than one workspace
 */
export type VerifyResponse =
  | { status: 'ok'; user: User }
  | { status: 'signup_required'; email: string }
  | { status: 'choose_workspace'; email: string; workspaces: WorkspaceSummary[] };

/** A workspace's SSO entry point, resolved from the email's domain. */
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
