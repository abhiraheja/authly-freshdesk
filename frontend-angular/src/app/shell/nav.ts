import type { Tone } from '@trackly/core';
import type { IconName } from '@trackly/ui';

export interface NavItem {
  readonly label: string;
  readonly icon?: IconName;
  readonly route: string;
  /** Saved-view query params, e.g. `{ view: 'open' }`. */
  readonly params?: Readonly<Record<string, string>>;
  /** Which count from `/api/dashboard/stats` renders on the right. */
  readonly countKey?: string;
  /** Renders a status dot instead of an icon — used by the saved views. */
  readonly tone?: Tone;
  /** Admin-only rows are filtered out for agents. */
  readonly adminOnly?: boolean;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
  /** The whole group collapses behind a toggle when true. */
  readonly collapsible?: boolean;
  readonly adminOnly?: boolean;
}

/**
 * The agent/admin sidebar.
 *
 * The **Tickets** group is the important shape: ticket status filters are
 * first-class navigation with live counts, not options buried in a dropdown
 * inside the list. Each row is the same `/dashboard/tickets` route with a
 * different `?view=`, so the list's own filter bar and the sidebar are the same
 * piece of state — click "Open" in the rail and the filter bar reflects it.
 *
 * Admin has thirteen destinations, so it is collapsible; it opens automatically
 * on any `/admin` route (see the shell) and stays out of the way otherwise.
 */
export const NAV: readonly NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', icon: 'layout-dashboard', route: '/dashboard' }],
  },
  {
    label: 'Tickets',
    items: [
      { label: 'All tickets', icon: 'ticket', route: '/dashboard/tickets', countKey: 'total' },
      { label: 'Assigned to me', icon: 'user-check', route: '/dashboard/tickets', params: { view: 'mine' }, countKey: 'assignedToMe' },
      // An "Unassigned" view belongs here too, but `GET /api/tickets` has no way
      // to express it — `assigneeId` only matches a specific agent. Adding the
      // row before the API can filter would give a view that silently shows the
      // wrong tickets. It lands with the API change.
      { label: 'Open', tone: 'info', route: '/dashboard/tickets', params: { view: 'open' }, countKey: 'open' },
      { label: 'Pending', tone: 'warning', route: '/dashboard/tickets', params: { view: 'pending' }, countKey: 'pending' },
      { label: 'Resolved', tone: 'success', route: '/dashboard/tickets', params: { view: 'resolved' }, countKey: 'resolved' },
      { label: 'Closed', tone: 'neutral', route: '/dashboard/tickets', params: { view: 'closed' }, countKey: 'closed' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Live chat', icon: 'messages-square', route: '/dashboard/chat' },
      { label: 'Problems', icon: 'puzzle', route: '/dashboard/problems', countKey: 'openProblems' },
      { label: 'Knowledge base', icon: 'book-open', route: '/dashboard/kb' },
      { label: 'Canned responses', icon: 'zap', route: '/dashboard/canned' },
    ],
  },
  {
    label: 'Admin',
    collapsible: true,
    adminOnly: true,
    items: [
      { label: 'Analytics', icon: 'bar-chart-3', route: '/admin/analytics' },
      { label: 'Announcements', icon: 'megaphone', route: '/admin/announcements' },
      { label: 'Members', icon: 'users', route: '/admin/users' },
      { label: 'Teams', icon: 'user-cog', route: '/admin/teams' },
      { label: 'SLA policies', icon: 'timer', route: '/admin/settings/sla' },
      { label: 'Automation', icon: 'workflow', route: '/admin/automation' },
      { label: 'AI copilot', icon: 'sparkles', route: '/admin/settings/ai' },
      { label: 'Messaging', icon: 'message-circle', route: '/admin/channels' },
      { label: 'Widget', icon: 'globe', route: '/admin/widget' },
      { label: 'Email', icon: 'mail', route: '/admin/settings/email' },
      { label: 'Branding', icon: 'palette', route: '/admin/settings/branding' },
      { label: 'SSO', icon: 'shield-check', route: '/admin/settings/sso' },
      { label: 'Domains', icon: 'at-sign', route: '/admin/settings/domains' },
    ],
  },
];

/** The customer portal's much shorter rail. */
export const PORTAL_NAV: readonly NavGroup[] = [
  {
    label: 'Support',
    items: [
      { label: 'My tickets', icon: 'ticket', route: '/portal' },
      { label: 'New ticket', icon: 'plus', route: '/portal/tickets/new' },
    ],
  },
];
