import type { Routes } from '@angular/router';

/**
 * Mounted by the host at `/admin`, behind `roleGuard('admin')`.
 *
 * Every entry is a placeholder until its React screen is ported — each `from:`
 * names the file to port. Replace one `loadComponent` at a time; the route path
 * never has to change.
 */
const placeholder = () => import('@trackly/ui').then((m) => m.ComingSoon);

export const adminRoutes: Routes = [
  {
    path: 'users',
    loadComponent: () => import('./members').then((m) => m.AdminMembers),
  },
  {
    // The screen that decides who can get in at all — and refuses to let
    // an admin switch off the last working method.
    path: 'settings/login',
    loadComponent: () => import('./login-settings').then((m) => m.AdminLoginSettings),
  },
  {
    // Which identity providers this installation offers, and to whom.
    path: 'settings/sso',
    loadComponent: () => import('./sso-settings').then((m) => m.AdminSsoSettings),
  },
  {
    // Which mail providers this installation sends and receives through.
    path: 'settings/email',
    loadComponent: () => import('./email-settings').then((m) => m.AdminEmailSettings),
  },
  {
    // The subject and body of every message Trackly sends. Sits under email
    // rather than beside it — a template is useless without a way to send it.
    path: 'settings/email/templates',
    loadComponent: () => import('./email-templates').then((m) => m.AdminEmailTemplates),
  },
  {
    path: 'settings/email/templates/:key',
    loadComponent: () => import('./email-template-form').then((m) => m.AdminEmailTemplateForm),
  },
  {
    path: 'settings/configuration',
    loadComponent: () => import('./configuration').then((m) => m.AdminConfiguration),
  },
  {
    path: 'settings/storage',
    loadComponent: () => import('./storage-settings').then((m) => m.AdminStorageSettings),
  },
  {
    path: 'settings/sla',
    loadComponent: () => import('./sla-settings').then((m) => m.SlaSettings),
  },
  {
    path: 'settings/ticket-layout',
    loadComponent: () => import('./ticket-layout-settings').then((m) => m.TicketLayoutSettings),
  },
  {
    path: 'settings/catalogue',
    loadComponent: () => import('./catalogue-settings').then((m) => m.CatalogueSettings),
  },
  {
    path: 'settings/statuses',
    loadComponent: () => import('./ticket-status-settings').then((m) => m.TicketStatusSettings),
  },
  {
    path: 'settings/rewards',
    loadComponent: () => import('./reward-settings').then((m) => m.RewardSettings),
  },
  { path: 'analytics', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.analytics', from: 'frontend/src/pages/admin/AnalyticsPage.tsx' } },
  { path: 'announcements', loadComponent: () => import('./announcements').then((m) => m.Announcements) },
  { path: 'teams', loadComponent: () => import('./teams').then((m) => m.Teams) },
  { path: 'automation', loadComponent: () => import('./automation').then((m) => m.Automation) },
  { path: 'channels', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.messagingChannels', from: 'frontend/src/pages/admin/ChannelsPage.tsx' } },
  {
    // Every embeddable widget the workspace runs, and — on its Branding tab —
    // the workspace branding record (docs/widget-plan.md § 4.2).
    path: 'widget',
    loadComponent: () => import('./widget-list').then((m) => m.AdminWidgetList),
  },
  {
    path: 'widget/:id',
    loadComponent: () => import('./widget-editor').then((m) => m.AdminWidgetEditor),
  },
  { path: 'settings/ai', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.aiCopilot', from: 'frontend/src/pages/admin/AiSettingsPage.tsx' } },
  // /admin/settings/branding is deliberately gone — branding is edited on the
  // widget screen's Branding tab now, so there is exactly one place for it
  // (§ 4.2). A redirect rather than a deletion, because the URL is in bookmarks
  // and in the admin guide's older revisions.
  { path: 'settings/branding', redirectTo: 'widget', pathMatch: 'full' },
];
