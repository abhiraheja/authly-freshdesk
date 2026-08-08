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
  { path: 'analytics', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.analytics', from: 'frontend/src/pages/admin/AnalyticsPage.tsx' } },
  { path: 'announcements', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.announcements', from: 'frontend/src/pages/admin/AnnouncementsPage.tsx' } },
  { path: 'teams', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.teams', from: 'frontend/src/pages/admin/TeamsPage.tsx' } },
  { path: 'automation', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.automation', from: 'frontend/src/pages/admin/AutomationPage.tsx' } },
  { path: 'channels', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.messagingChannels', from: 'frontend/src/pages/admin/ChannelsPage.tsx' } },
  { path: 'widget', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.widget', from: 'frontend/src/pages/admin/WidgetPage.tsx' } },
  { path: 'settings/ai', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.aiCopilot', from: 'frontend/src/pages/admin/AiSettingsPage.tsx' } },
  { path: 'settings/email', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.email', from: 'frontend/src/pages/admin/EmailSettingsPage.tsx' } },
  { path: 'settings/branding', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.branding', from: 'frontend/src/pages/admin/BrandingSettingsPage.tsx' } },
];
