import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FaviconService } from '@trackly/core';

/**
 * Root component. Deliberately just the outlet — the shell (sidebar + top bar)
 * is a *routed* component, so full-screen surfaces (login, the guest ticket
 * view, the customer submit form) render without it.
 *
 * The one thing it does own is the browser tab's icon, which is global rather
 * than per-route: swapping it on navigation would only make it flicker.
 */
@Component({
  selector: 'tk-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  constructor() {
    // Fire and forget. The shipped favicon.ico stands in until this lands, and
    // the service swallows its own failures — a tab icon is never worth an error.
    void inject(FaviconService).applyWorkspaceLogo();
  }
}
