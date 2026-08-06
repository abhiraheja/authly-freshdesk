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
  { path: 'analytics', loadComponent: placeholder, data: { title: 'Analytics', from: 'frontend/src/pages/admin/AnalyticsPage.tsx' } },
  { path: 'announcements', loadComponent: placeholder, data: { title: 'Announcements', from: 'frontend/src/pages/admin/AnnouncementsPage.tsx' } },
  { path: 'users', loadComponent: placeholder, data: { title: 'Members', from: 'frontend/src/pages/admin/UsersPage.tsx' } },
  { path: 'teams', loadComponent: placeholder, data: { title: 'Teams', from: 'frontend/src/pages/admin/TeamsPage.tsx' } },
  { path: 'automation', loadComponent: placeholder, data: { title: 'Automation', from: 'frontend/src/pages/admin/AutomationPage.tsx' } },
  { path: 'channels', loadComponent: placeholder, data: { title: 'Messaging channels', from: 'frontend/src/pages/admin/ChannelsPage.tsx' } },
  { path: 'widget', loadComponent: placeholder, data: { title: 'Widget', from: 'frontend/src/pages/admin/WidgetPage.tsx' } },
  { path: 'settings/sla', loadComponent: placeholder, data: { title: 'SLA policies', from: 'frontend/src/pages/admin/SlaSettingsPage.tsx' } },
  { path: 'settings/ai', loadComponent: placeholder, data: { title: 'AI copilot', from: 'frontend/src/pages/admin/AiSettingsPage.tsx' } },
  { path: 'settings/email', loadComponent: placeholder, data: { title: 'Email', from: 'frontend/src/pages/admin/EmailSettingsPage.tsx' } },
  { path: 'settings/branding', loadComponent: placeholder, data: { title: 'Branding', from: 'frontend/src/pages/admin/BrandingSettingsPage.tsx' } },
  { path: 'settings/sso', loadComponent: placeholder, data: { title: 'SSO', from: 'frontend/src/pages/admin/SsoSettingsPage.tsx' } },
  { path: 'settings/domains', loadComponent: placeholder, data: { title: 'Domains', from: 'frontend/src/pages/admin/DomainsPage.tsx' } },
];
