import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Root component. Deliberately just the outlet — the shell (sidebar + top bar)
 * is a *routed* component, so full-screen surfaces (login, the guest ticket
 * view, the customer submit form) render without it.
 */
@Component({
  selector: 'tk-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
