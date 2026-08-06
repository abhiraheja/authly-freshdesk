import type { Routes } from '@angular/router';

/** Mounted by the host at `/dashboard`. */
export const dashboardRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./dashboard').then((m) => m.Dashboard),
  },
];
