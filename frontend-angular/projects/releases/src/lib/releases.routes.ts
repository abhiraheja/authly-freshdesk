import type { Routes } from '@angular/router';

/**
 * Mounted by the host at `/dashboard/releases`, inside the shell and behind the
 * agent guard. Releases are internal: how the workspace ships is not something a
 * customer has any business reading.
 */
export const releaseRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./release-list').then((m) => m.ReleaseList),
  },
  {
    // `:id` binds straight to the component's `id` input via
    // withComponentInputBinding() — no ActivatedRoute plumbing.
    path: ':id',
    loadComponent: () => import('./release-detail').then((m) => m.ReleaseDetail),
  },
];
