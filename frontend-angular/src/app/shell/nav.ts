import type { Tone } from '@trackly/core';
import type { IconName } from '@trackly/ui';

export interface NavItem {
  readonly labelKey: string;
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
  readonly labelKey: string;
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
    labelKey: 'nav.groups.overview',
    items: [{ labelKey: 'nav.items.dashboard', icon: 'layout-dashboard', route: '/dashboard' }],
  },
  {
    labelKey: 'nav.groups.tickets',
    items: [
      { labelKey: 'nav.items.allTickets', icon: 'ticket', route: '/dashboard/tickets', countKey: 'total' },
      { labelKey: 'nav.items.assignedToMe', icon: 'user-check', route: '/dashboard/tickets', params: { view: 'mine' }, countKey: 'assignedToMe' },
      // An "Unassigned" view belongs here too, but `GET /api/tickets` has no way
      // to express it — `assigneeId` only matches a specific agent. Adding the
      // row before the API can filter would give a view that silently shows the
      // wrong tickets. It lands with the API change.
      { labelKey: 'nav.items.open', tone: 'info', route: '/dashboard/tickets', params: { view: 'open' }, countKey: 'open' },
      { labelKey: 'nav.items.pending', tone: 'warning', route: '/dashboard/tickets', params: { view: 'pending' }, countKey: 'pending' },
      { labelKey: 'nav.items.resolved', tone: 'success', route: '/dashboard/tickets', params: { view: 'resolved' }, countKey: 'resolved' },
      { labelKey: 'nav.items.closed', tone: 'neutral', route: '/dashboard/tickets', params: { view: 'closed' }, countKey: 'closed' },
    ],
  },
  {
    labelKey: 'nav.groups.workspace',
    items: [
      { labelKey: 'nav.items.liveChat', icon: 'messages-square', route: '/dashboard/chat' },
      { labelKey: 'nav.items.problems', icon: 'puzzle', route: '/dashboard/problems', countKey: 'openProblems' },
      { labelKey: 'nav.items.knowledgeBase', icon: 'book-open', route: '/dashboard/kb' },
      { labelKey: 'nav.items.cannedResponses', icon: 'zap', route: '/dashboard/canned' },
    ],
  },
  {
    labelKey: 'nav.groups.admin',
    collapsible: true,
    adminOnly: true,
    items: [
      { labelKey: 'nav.items.configuration', icon: 'sliders-horizontal', route: '/admin/settings/configuration' },
      { labelKey: 'nav.items.analytics', icon: 'bar-chart-3', route: '/admin/analytics' },
      { labelKey: 'nav.items.announcements', icon: 'megaphone', route: '/admin/announcements' },
      { labelKey: 'nav.items.members', icon: 'users', route: '/admin/users' },
      { labelKey: 'nav.items.teams', icon: 'user-cog', route: '/admin/teams' },
      { labelKey: 'nav.items.sla', icon: 'timer', route: '/admin/settings/sla' },
      { labelKey: 'nav.items.automation', icon: 'workflow', route: '/admin/automation' },
      { labelKey: 'nav.items.aiCopilot', icon: 'sparkles', route: '/admin/settings/ai' },
      { labelKey: 'nav.items.messaging', icon: 'message-circle', route: '/admin/channels' },
      { labelKey: 'nav.items.widget', icon: 'globe', route: '/admin/widget' },
      { labelKey: 'nav.items.email', icon: 'mail', route: '/admin/settings/email' },
      { labelKey: 'nav.items.storage', icon: 'upload-cloud', route: '/admin/settings/storage' },
      { labelKey: 'nav.items.branding', icon: 'palette', route: '/admin/settings/branding' },
      { labelKey: 'nav.items.sso', icon: 'shield-check', route: '/admin/settings/sso' },
      { labelKey: 'nav.items.domains', icon: 'at-sign', route: '/admin/settings/domains' },
    ],
  },
];

/** The customer portal's much shorter rail. */
export const PORTAL_NAV: readonly NavGroup[] = [
  {
    labelKey: 'nav.groups.support',
    items: [
      { labelKey: 'nav.items.myTickets', icon: 'ticket', route: '/portal' },
      { labelKey: 'nav.items.newTicket', icon: 'plus', route: '/portal/tickets/new' },
    ],
  },
];
