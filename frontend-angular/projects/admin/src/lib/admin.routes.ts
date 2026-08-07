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
  { path: 'analytics', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.analytics', from: 'frontend/src/pages/admin/AnalyticsPage.tsx' } },
  { path: 'announcements', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.announcements', from: 'frontend/src/pages/admin/AnnouncementsPage.tsx' } },
  { path: 'users', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.members', from: 'frontend/src/pages/admin/UsersPage.tsx' } },
  { path: 'teams', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.teams', from: 'frontend/src/pages/admin/TeamsPage.tsx' } },
  { path: 'automation', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.automation', from: 'frontend/src/pages/admin/AutomationPage.tsx' } },
  { path: 'channels', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.messagingChannels', from: 'frontend/src/pages/admin/ChannelsPage.tsx' } },
  { path: 'widget', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.widget', from: 'frontend/src/pages/admin/WidgetPage.tsx' } },
  { path: 'settings/ai', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.aiCopilot', from: 'frontend/src/pages/admin/AiSettingsPage.tsx' } },
  { path: 'settings/email', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.email', from: 'frontend/src/pages/admin/EmailSettingsPage.tsx' } },
  { path: 'settings/branding', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.branding', from: 'frontend/src/pages/admin/BrandingSettingsPage.tsx' } },
  { path: 'settings/sso', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.sso', from: 'frontend/src/pages/admin/SsoSettingsPage.tsx' } },
  { path: 'settings/domains', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.domains', from: 'frontend/src/pages/admin/DomainsPage.tsx' } },
];
