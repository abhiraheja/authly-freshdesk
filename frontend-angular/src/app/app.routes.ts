import type { Routes } from '@angular/router';
import { authGuard, roleGuard } from '@trackly/core';
import { authRoutes } from '@trackly/auth';
import { guestRoutes } from '@trackly/guest';

/**
 * The app's job is to **mount** libraries, not to know what is inside them.
 * Each feature library owns its own route table.
 *
 * **There is exactly one `path: ''` route, and it is the shell.** That is not a
 * style choice. Angular matches empty-path routes in order and does not
 * backtrack out of a lazy config once it has been loaded, so two sibling
 * `path: ''` entries with `loadChildren` will silently render nothing for any
 * URL the first one fails to match. Auth and guest screens live at top-level
 * URLs (`/login`, `/submit`), so their tables are **spread** here rather than
 * mounted. The tables are a few hundred bytes; every screen inside them is
 * still `loadComponent`, so nothing extra reaches the initial bundle. Their
 * barrels export the route table only, for exactly this reason.
 *
 * Libraries that sit under a real path prefix (`/dashboard`, `/admin`, …) use
 * `loadChildren` and stay entirely lazy.
 *
 * Three rings:
 *  1. **Public** — auth screens, then the workspace-branded customer surfaces.
 *     Full-screen, outside the shell.
 *  2. **`authGuard`** — the shell. Signed-out visitors go to /login carrying the
 *     URL they wanted, so signing in lands them where they were headed.
 *  3. **`roleGuard`** — agent/admin and admin-only areas inside the shell.
 *
 * Guards are the navigation story only. Every endpoint re-checks server-side; a
 * hidden route is not a permission.
 */
export const routes: Routes = [
  // 1. Full-screen, unauthenticated
  ...authRoutes,
  ...guestRoutes,

  // 2. The shell
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      {
        path: 'portal',
        loadChildren: () => import('@trackly/portal').then((m) => m.portalRoutes),
      },
      {
        path: 'dashboard',
        canActivate: [roleGuard('agent', 'admin')],
        loadChildren: () => import('@trackly/dashboard').then((m) => m.dashboardRoutes),
      },
      {
        path: 'dashboard/tickets',
        canActivate: [roleGuard('agent', 'admin')],
        loadChildren: () => import('@trackly/tickets').then((m) => m.ticketsRoutes),
      },
      {
        path: 'dashboard/chat',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('@trackly/ui').then((m) => m.ComingSoon),
        data: { titleKey: 'comingSoon.titles.liveChat', from: 'frontend/src/pages/agent/ChatConsolePage.tsx' },
      },
      {
        path: 'dashboard/problems',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('@trackly/ui').then((m) => m.ComingSoon),
        data: { titleKey: 'comingSoon.titles.problems', from: 'frontend/src/pages/agent/ProblemsPage.tsx' },
      },
      {
        path: 'dashboard/kb',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('@trackly/ui').then((m) => m.ComingSoon),
        data: { titleKey: 'comingSoon.titles.knowledgeBase', from: 'frontend/src/pages/admin/KbPage.tsx' },
      },
      {
        path: 'dashboard/canned',
        canActivate: [roleGuard('agent', 'admin')],
        loadComponent: () => import('@trackly/ui').then((m) => m.ComingSoon),
        data: { titleKey: 'comingSoon.titles.cannedResponses', from: 'frontend/src/pages/agent/CannedResponsesPage.tsx' },
      },
      {
        path: 'admin',
        canActivate: [roleGuard('admin')],
        loadChildren: () => import('@trackly/admin').then((m) => m.adminRoutes),
      },

      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },

  { path: '**', redirectTo: '' },
];
