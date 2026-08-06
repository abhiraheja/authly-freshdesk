import type { Routes } from '@angular/router';

/**
 * Mounted by the host at `/portal` — the signed-in **customer's** view of their
 * own tickets.
 *
 * These render inside the shell but are customer-facing: they wear the
 * workspace's branding and are always light (invariant 6). They must never show
 * a private note, an internal field, or another customer's ticket.
 */
const placeholder = () => import('@trackly/ui').then((m) => m.ComingSoon);

export const portalRoutes: Routes = [
  { path: '', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.myTickets', from: 'frontend/src/pages/portal/PortalTicketsPage.tsx' } },
  { path: 'tickets/new', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.newTicket', from: 'frontend/src/pages/portal/NewTicketPage.tsx' } },
  { path: 'tickets/:id', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.ticket', from: 'frontend/src/pages/portal/PortalTicketDetailPage.tsx' } },
];
