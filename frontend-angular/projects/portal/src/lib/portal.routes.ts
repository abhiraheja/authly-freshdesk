import type { Routes } from '@angular/router';

/**
 * Mounted by the host at `/portal` — the signed-in **customer's** view of their
 * own tickets.
 *
 * These render **outside** the agent Shell, inside `PortalFrame`: they are
 * customer-facing, so they wear the workspace's branding and are always light
 * (invariant 6). A customer gets no Trackly mark, no command palette and no
 * navigation rail — see `BrandedFrame` for why.
 *
 * One `path: ''` here, and it is the frame. That is the whole reason the frame
 * can hold the branding for the visit instead of each screen refetching it.
 */
export const portalRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./portal-frame').then((m) => m.PortalFrame),
    children: [
      {
        path: '',
        loadComponent: () => import('./portal-tickets').then((m) => m.PortalTickets),
      },
      // The form before the detail: different paths, so the order is for the
      // reader rather than for the matcher.
      {
        path: 'tickets/new',
        loadComponent: () => import('./portal-ticket-new').then((m) => m.PortalTicketNew),
      },
      {
        path: 'tickets/:id',
        loadComponent: () => import('./portal-ticket-detail').then((m) => m.PortalTicketDetail),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
