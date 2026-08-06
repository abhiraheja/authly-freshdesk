import type { Routes } from '@angular/router';

/**
 * Anonymous, workspace-branded surfaces. Mounted by the host at the app root,
 * **outside** the shell — a visitor here has no Trackly session and may not even
 * have an account.
 *
 * Every route in this library:
 * - wears the workspace's `primaryColor` and logo, never Trackly's
 * - is **always light** — a customer does not toggle a tenant's brand into dark
 * - shows "Powered by Trackly" only when `hidePoweredBy` is false
 *
 * That is invariant 6, and it is the reason these live in their own library
 * rather than alongside the agent screens: the constraint is easy to forget when
 * the two sit in one folder.
 */
const placeholder = () => import('@trackly/ui').then((m) => m.ComingSoon);

export const guestRoutes: Routes = [
  { path: 'submit', loadComponent: placeholder, data: { title: 'Submit a ticket', from: 'frontend/src/pages/public/SubmitPage.tsx', branded: true } },
  { path: 'kb', loadComponent: placeholder, data: { title: 'Knowledge base', from: 'frontend/src/pages/public/PublicKbPage.tsx', branded: true } },
  { path: 'chat', loadComponent: placeholder, data: { title: 'Live chat', from: 'frontend/src/pages/public/ChatPage.tsx', branded: true } },
  { path: 'csat/:ticketId', loadComponent: placeholder, data: { title: 'Rate your support', from: 'frontend/src/pages/public/CsatPage.tsx', branded: true } },
  { path: 'tickets/:id', loadComponent: placeholder, data: { title: 'Your ticket', from: 'frontend/src/pages/public/GuestTicketPage.tsx', branded: true } },
  { path: 'invite/:token', loadComponent: placeholder, data: { title: 'Accept invitation', from: 'frontend/src/pages/public/InviteAcceptPage.tsx', branded: true } },
];
