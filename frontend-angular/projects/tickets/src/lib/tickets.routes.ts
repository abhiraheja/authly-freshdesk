import type { Routes } from '@angular/router';

/**
 * Mounted by the host at `/dashboard/tickets`.
 *
 * A library owns its own route table so the app never has to know its internal
 * structure — adding a ticket sub-screen touches this file only.
 */
export const ticketsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./ticket-list').then((m) => m.TicketList),
  },
  {
    path: 'new',
    loadComponent: () => import('./ticket-new').then((m) => m.TicketNew),
  },
  {
    path: ':id',
    loadComponent: () => import('./ticket-detail').then((m) => m.TicketDetail),
  },
];
