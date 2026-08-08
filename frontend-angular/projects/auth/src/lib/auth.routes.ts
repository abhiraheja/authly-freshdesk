import type { Routes } from '@angular/router';
import { guestGuard, setupGuard } from '@trackly/core';

/**
 * Mounted by the host at the app root, outside the shell — these are
 * full-screen surfaces.
 *
 * `guestGuard` keeps an already-signed-in visitor off them: landing on /login
 * with a live session should take you home, not ask you to sign in again.
 */
export const authRoutes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./login').then((m) => m.Login),
  },
  {
    // First run only. Trackly is self-hosted, so there is no public sign-up —
    // the workspace is created once, by whoever stands up the installation.
    path: 'setup',
    canActivate: [setupGuard],
    loadComponent: () => import('./setup').then((m) => m.Setup),
  },
  {
    // Magic-link landing. The token is NEVER consumed on load — only the confirm
    // button posts it, because email scanners prefetch GET links and would
    // otherwise burn the token before the recipient ever clicked (invariant 7).
    path: 'auth/verify',
    loadComponent: () => import('@trackly/ui').then((m) => m.ComingSoon),
    data: { titleKey: 'comingSoon.titles.verifySignIn', from: 'frontend/src/pages/VerifyPage.tsx' },
  },
  {
    path: 'auth/sso/complete',
    loadComponent: () => import('@trackly/ui').then((m) => m.ComingSoon),
    data: { titleKey: 'comingSoon.titles.signingIn', from: 'frontend/src/pages/auth/SsoCompletePage.tsx' },
  },
];
