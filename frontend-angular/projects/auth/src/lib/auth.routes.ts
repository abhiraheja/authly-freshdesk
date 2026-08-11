import type { Routes } from '@angular/router';
import { authGuard, guestGuard, setupGuard } from '@trackly/core';

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
    // Outside the shell, like the other auth screens: someone on a temporary
    // password cannot use the app yet, so wrapping this in the app chrome would
    // put a navigation menu around a door they cannot open.
    path: 'account/password',
    canActivate: [authGuard],
    loadComponent: () => import('./change-password').then((m) => m.ChangePassword),
  },
  {
    // Magic-link landing. The token is NEVER consumed on load — only the confirm
    // button posts it, because email scanners prefetch GET links and would
    // otherwise burn the token before the recipient ever clicked (invariant 7).
    path: 'auth/verify',
    loadComponent: () => import('./verify').then((m) => m.Verify),
  },
  {
    // Where the SSO callback lands once Trackly has issued its own session.
    // No guestGuard: arriving here signed in is the success case, not a mistake.
    path: 'auth/sso/complete',
    loadComponent: () => import('./sso-complete').then((m) => m.SsoComplete),
  },
];
