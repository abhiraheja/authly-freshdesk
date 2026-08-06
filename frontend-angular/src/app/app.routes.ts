import type { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth/guards';

/**
 * Route map, mirroring the React app it replaces.
 *
 * Three rings, in this order:
 *  1. **Public** — auth screens and every workspace-branded customer surface.
 *     These render full-screen, outside the shell.
 *  2. **`authGuard`** — the shell. A signed-out visitor is sent to /login with
 *     the URL they wanted, so signing in lands them where they were headed.
 *  3. **`roleGuard`** — agent/admin and admin-only areas inside the shell.
 *
 * Guards are the navigation story only. Every endpoint re-checks server-side;
 * a hidden route is not a permission.
 *
 * Routes marked `[port]` are wired to a placeholder while the screen is being
 * migrated from `frontend/`. Every sidebar link therefore leads somewhere real,
 * and the remaining work is visible instead of being a dead link.
 */
export const routes: Routes = [
  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.Login),
  },
  {
    path: 'signup',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.Login),
    data: { mode: 'signup' },
  },
  {
    // Magic-link landing. The token is NEVER consumed on load — only the confirm
    // button posts it, because email scanners prefetch GET links and would
    // otherwise burn the token before the recipient clicked (invariant 7).
    path: 'auth/verify',
    loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
    data: { title: 'Verify sign-in', from: 'frontend/src/pages/VerifyPage.tsx' },
  },

  // ── Customer-facing, workspace-branded (always light, never Trackly's brand) ─
  {
    path: 'submit',
    loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
    data: { title: 'Submit a ticket', from: 'frontend/src/pages/public/SubmitPage.tsx', branded: true },
  },
  {
    path: 'kb',
    loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
    data: { title: 'Knowledge base', from: 'frontend/src/pages/public/PublicKbPage.tsx', branded: true },
  },
  {
    path: 'chat',
    loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
    data: { title: 'Live chat', from: 'frontend/src/pages/public/ChatPage.tsx', branded: true },
  },
  {
    path: 'csat/:ticketId',
    loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
    data: { title: 'Rate your support', from: 'frontend/src/pages/public/CsatPage.tsx', branded: true },
  },
  {
    path: 'tickets/:id',
    loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
    data: { title: 'Your ticket', from: 'frontend/src/pages/public/GuestTicketPage.tsx', branded: true },
  },
  {
    path: 'invite/:token',
    loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
    data: { title: 'Accept invitation', from: 'frontend/src/pages/public/InviteAcceptPage.tsx', branded: true },
  },

  // ── The shell ─────────────────────────────────────────────────────────────
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      // Customer portal
      {
        path: 'portal',
        loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
        data: { title: 'My tickets', from: 'frontend/src/pages/portal/PortalTicketsPage.tsx' },
      },
      {
        path: 'portal/tickets/new',
        loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
        data: { title: 'New ticket', from: 'frontend/src/pages/portal/NewTicketPage.tsx' },
      },
      {
        path: 'portal/tickets/:id',
        loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
        data: { title: 'Ticket', from: 'frontend/src/pages/portal/PortalTicketDetailPage.tsx' },
      },

      // Agent + admin
      {
        path: 'dashboard',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'dashboard/tickets',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('./features/tickets/ticket-list').then((m) => m.TicketList),
      },
      {
        path: 'dashboard/tickets/new',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
        data: { title: 'New ticket' },
      },
      {
        path: 'dashboard/tickets/:id',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
        data: { title: 'Ticket', from: 'frontend/src/pages/agent/AgentWorkspacePage.tsx' },
      },
      {
        path: 'dashboard/chat',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
        data: { title: 'Live chat', from: 'frontend/src/pages/agent/ChatConsolePage.tsx' },
      },
      {
        path: 'dashboard/problems',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
        data: { title: 'Problems', from: 'frontend/src/pages/agent/ProblemsPage.tsx' },
      },
      {
        path: 'dashboard/kb',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
        data: { title: 'Knowledge base', from: 'frontend/src/pages/admin/KbPage.tsx' },
      },
      {
        path: 'dashboard/canned',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('./features/shared/coming-soon').then((m) => m.ComingSoon),
        data: { title: 'Canned responses', from: 'frontend/src/pages/agent/CannedResponsesPage.tsx' },
      },

      // Admin only
      {
        path: 'admin',
        canActivate: [roleGuard('admin')],
        children: [
          { path: 'analytics', loadComponent: comingSoon, data: { title: 'Analytics', from: 'frontend/src/pages/admin/AnalyticsPage.tsx' } },
          { path: 'announcements', loadComponent: comingSoon, data: { title: 'Announcements', from: 'frontend/src/pages/admin/AnnouncementsPage.tsx' } },
          { path: 'users', loadComponent: comingSoon, data: { title: 'Members', from: 'frontend/src/pages/admin/UsersPage.tsx' } },
          { path: 'teams', loadComponent: comingSoon, data: { title: 'Teams', from: 'frontend/src/pages/admin/TeamsPage.tsx' } },
          { path: 'automation', loadComponent: comingSoon, data: { title: 'Automation', from: 'frontend/src/pages/admin/AutomationPage.tsx' } },
          { path: 'channels', loadComponent: comingSoon, data: { title: 'Messaging channels', from: 'frontend/src/pages/admin/ChannelsPage.tsx' } },
          { path: 'widget', loadComponent: comingSoon, data: { title: 'Widget', from: 'frontend/src/pages/admin/WidgetPage.tsx' } },
          { path: 'settings/sla', loadComponent: comingSoon, data: { title: 'SLA policies', from: 'frontend/src/pages/admin/SlaSettingsPage.tsx' } },
          { path: 'settings/ai', loadComponent: comingSoon, data: { title: 'AI copilot', from: 'frontend/src/pages/admin/AiSettingsPage.tsx' } },
          { path: 'settings/email', loadComponent: comingSoon, data: { title: 'Email', from: 'frontend/src/pages/admin/EmailSettingsPage.tsx' } },
          { path: 'settings/branding', loadComponent: comingSoon, data: { title: 'Branding', from: 'frontend/src/pages/admin/BrandingSettingsPage.tsx' } },
          { path: 'settings/sso', loadComponent: comingSoon, data: { title: 'SSO', from: 'frontend/src/pages/admin/SsoSettingsPage.tsx' } },
          { path: 'settings/domains', loadComponent: comingSoon, data: { title: 'Domains', from: 'frontend/src/pages/admin/DomainsPage.tsx' } },
        ],
      },

      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },

  { path: '**', redirectTo: '' },
];

/** Shared lazy loader for the not-yet-ported admin screens. */
function comingSoon() {
  return import('./features/shared/coming-soon').then((m) => m.ComingSoon);
}
