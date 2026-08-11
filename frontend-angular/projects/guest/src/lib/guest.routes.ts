import type { Routes } from '@angular/router';
import { WidgetBridge } from './widget/widget-bridge';

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
  { path: 'submit', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.submitTicket', from: 'frontend/src/pages/public/SubmitPage.tsx', branded: true } },
  { path: 'kb', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.knowledgeBase', from: 'frontend/src/pages/public/PublicKbPage.tsx', branded: true } },
  { path: 'chat', loadComponent: () => import('./chat-visitor').then((m) => m.ChatVisitor) },
  { path: 'csat/:ticketId', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.rateSupport', from: 'frontend/src/pages/public/CsatPage.tsx', branded: true } },
  { path: 'tickets/:id', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.yourTicket', from: 'frontend/src/pages/public/GuestTicketPage.tsx', branded: true } },
  { path: 'invite/:token', loadComponent: placeholder, data: { titleKey: 'comingSoon.titles.acceptInvitation', from: 'frontend/src/pages/public/InviteAcceptPage.tsx', branded: true } },

  /**
   * The embeddable widget's panel — the document `widget.js` puts in its iframe
   * (docs/widget-plan.md § 8.1).
   *
   * `token` is the widget's **public** token: it sits in the page source of every
   * site that embeds the widget, so it identifies a widget and authorises
   * nothing. What a visitor may read is decided by the trust rule, server-side.
   *
   * It provides its own {@link WidgetBridge} rather than taking a root one: the
   * bridge holds one frame's conversation with one host page, and a root-scoped
   * instance would outlive the panel and keep a stale parent window.
   */
  {
    path: 'widget/:token',
    providers: [WidgetBridge],
    loadComponent: () => import('./widget/widget-panel').then((m) => m.WidgetPanel),
    data: { titleKey: 'widget.title', branded: true },
  },
];
