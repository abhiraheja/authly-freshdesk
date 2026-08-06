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
    loadComponent: () => import('@trackly/ui').then((m) => m.ComingSoon),
    data: { titleKey: 'comingSoon.titles.newTicket' },
  },
  {
    path: ':id',
    loadComponent: () => import('@trackly/ui').then((m) => m.ComingSoon),
    data: { titleKey: 'comingSoon.titles.ticket', from: 'frontend/src/pages/agent/AgentWorkspacePage.tsx' },
  },
];
