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
  /**
   * Starts closed. Only meaningful with `collapsible`.
   *
   * A group still opens by itself whenever one of its rows is the current route,
   * so a bookmarked or shared link never lands on a hidden row — see
   * `Shell.isGroupOpen`.
   */
  readonly collapsedByDefault?: boolean;
  /**
   * Opens the group for any URL under this prefix, not just an exact row match.
   *
   * Admin needs it: `/admin/settings/email/templates` is not the route of any row,
   * and without the prefix the group would slam shut the moment you navigated one
   * level deeper than the row you clicked.
   */
  readonly routePrefix?: string;
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
 * Admin has nineteen destinations, so it is collapsible; it opens automatically
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
      // Directly under Assigned to me, because it is the same question — "what is
      // on me?" — answered in the other unit. Tickets are what you owe people;
      // tasks are the steps you owe on them, and an agent planning their morning
      // reads the two together.
      { labelKey: 'nav.items.tasks', icon: 'clipboard-list', route: '/dashboard/tasks', countKey: 'myOpenTasks' },
      // The other two "needs me" views. They sit beside Assigned because they
      // answer the same question from different angles: a ticket can want your
      // attention without being yours.
      { labelKey: 'nav.items.mentioned', icon: 'at-sign', route: '/dashboard/tickets', params: { view: 'mentioned' }, countKey: 'mentioningMe' },
      { labelKey: 'nav.items.watching', icon: 'eye', route: '/dashboard/tickets', params: { view: 'watching' }, countKey: 'watchedByMe' },
      // Pinned is mine alone; flagged is the team's. Together because both
      // answer "what should I look at", from the two different directions.
      { labelKey: 'nav.items.pinned', icon: 'pin', route: '/dashboard/tickets', params: { view: 'pinned' } },
      { labelKey: 'nav.items.flagged', icon: 'flag', route: '/dashboard/tickets', params: { view: 'flagged' } },
      // An "Unassigned" view belongs here too, but `GET /api/tickets` has no way
      // to express it — `assigneeId` only matches a specific agent. Adding the
      // row before the API can filter would give a view that silently shows the
      // wrong tickets. It lands with the API change.
    ],
  },
  {
    // ── By status ──────────────────────────────────────────────────────────
    // Its own collapsible group rather than five more rows in Tickets above.
    //
    // These five are a different KIND of question. Everything in the group above
    // is "what involves me"; this is "where is the queue", which is a thing an
    // agent asks a few times a day and a lead asks constantly. Mixing them made
    // one twelve-row list where the top half was personal and the bottom half was
    // not, and the eye had to re-read it every time.
    //
    // Collapsed by default: an agent lives in Assigned to me, and the five status
    // counts are a drill-down from the dashboard rather than a daily route. The
    // shell reopens the group automatically whenever one of them is the current
    // route, so a bookmarked `?view=pending` never lands on a hidden row.
    labelKey: 'nav.groups.byStatus',
    collapsible: true,
    collapsedByDefault: true,
    items: [
      { labelKey: 'nav.items.open', tone: 'info', route: '/dashboard/tickets', params: { view: 'open' }, countKey: 'open' },
      { labelKey: 'nav.items.pending', tone: 'warning', route: '/dashboard/tickets', params: { view: 'pending' }, countKey: 'pending' },
      { labelKey: 'nav.items.active', tone: 'primary', route: '/dashboard/tickets', params: { view: 'active' } },
      { labelKey: 'nav.items.resolved', tone: 'success', route: '/dashboard/tickets', params: { view: 'resolved' }, countKey: 'resolved' },
      { labelKey: 'nav.items.closed', tone: 'neutral', route: '/dashboard/tickets', params: { view: 'closed' }, countKey: 'closed' },
    ],
  },
  {
    labelKey: 'nav.groups.workspace',
    items: [
      { labelKey: 'nav.items.liveChat', icon: 'messages-square', route: '/dashboard/chat' },
      { labelKey: 'nav.items.problems', icon: 'puzzle', route: '/dashboard/problems', countKey: 'openProblems' },
      // The people, before the things: a support desk is about who is asking long
      // before it is about what they are asking on.
      { labelKey: 'nav.items.customers', icon: 'user-round', route: '/dashboard/customers', countKey: 'customers' },
      // The two registers. Agent-facing, not admin-only: "is there a spare laptop"
      // and "is payments down" are support questions, and an agent who has to ask
      // an admin to look them up will simply not look them up.
      //
      // Services carries the count of how many are DOWN rather than how many exist
      // — a total never changes and so is never read, while "2" beside Services is
      // the one number on this rail that can interrupt somebody's morning.
      { labelKey: 'nav.items.assets', icon: 'hard-drive', route: '/dashboard/assets', countKey: 'activeAssets' },
      { labelKey: 'nav.items.services', icon: 'server', route: '/dashboard/services', countKey: 'servicesDown' },
      { labelKey: 'nav.items.knowledgeBase', icon: 'book-open', route: '/dashboard/kb' },
      { labelKey: 'nav.items.cannedResponses', icon: 'zap', route: '/dashboard/canned' },
    ],
  },
  {
    labelKey: 'nav.groups.admin',
    collapsible: true,
    collapsedByDefault: true,
    routePrefix: '/admin',
    adminOnly: true,
    items: [
      { labelKey: 'nav.items.configuration', icon: 'sliders-horizontal', route: '/admin/settings/configuration' },
      { labelKey: 'nav.items.statuses', icon: 'circle', route: '/admin/settings/statuses' },
      { labelKey: 'nav.items.catalogue', icon: 'clipboard-list', route: '/admin/settings/catalogue' },
      { labelKey: 'nav.items.rewards', icon: 'trophy', route: '/admin/settings/rewards' },
      { labelKey: 'nav.items.ticketLayout', icon: 'panel-left-close', route: '/admin/settings/ticket-layout' },
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
      // Directly under Email, and a row of its own: editing what the thirteen
      // messages say is a separate job from wiring up a provider, and it was
      // reachable only by knowing to look inside the Email page for a button.
      { labelKey: 'nav.items.emailTemplates', icon: 'file-text', route: '/admin/settings/email/templates' },
      { labelKey: 'nav.items.storage', icon: 'upload-cloud', route: '/admin/settings/storage' },
      // No Branding row. It lives on the widget screen's Branding tab now, so a
      // second entry here would be two doors into one record — and the one thing
      // the merge was for is that an admin stops wondering which of them wins
      // (docs/widget-plan.md § 4.2).
      { labelKey: 'nav.items.login', icon: 'lock', route: '/admin/settings/login' },
      { labelKey: 'nav.items.sso', icon: 'shield-check', route: '/admin/settings/sso' },
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
