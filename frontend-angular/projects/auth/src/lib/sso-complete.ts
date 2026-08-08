import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthApi, SessionStore, homePathFor } from '@trackly/core';
import { Spinner } from '@trackly/ui';

/**
 * Where the SSO callback lands.
 *
 * By the time the browser gets here the work is done: the provider authenticated
 * the user, Trackly issued its own session and set the cookie. This screen only
 * has to notice — read the profile the cookie now grants, prime the session
 * store, and route by role.
 *
 * It is a screen rather than a redirect because the session lives in an HttpOnly
 * cookie: the SPA cannot see it, so the only way to know the sign-in took is to
 * ask the API. A failure here means the cookie did not survive — which is a
 * sign-in that did not happen, so it goes back to /login saying so rather than
 * dropping someone on a blank page.
 */
@Component({
  selector: 'tk-sso-complete',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Spinner],
  template: `
    <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <tk-spinner [size]="28" />
      <p class="text-body text-muted-foreground">{{ 'login.completing' | transloco }}</p>
    </div>
  `,
})
export class SsoComplete {
  private readonly auth = inject(AuthApi);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  /** Guards against a second run if the component is re-entered mid-navigation. */
  private readonly settling = signal(false);

  constructor() {
    void this.complete();
  }

  private async complete(): Promise<void> {
    if (this.settling()) return;
    this.settling.set(true);

    try {
      const user = await this.auth.me();
      this.session.set(user);

      // A temporary password still has to be replaced — SSO does not exempt
      // anyone, and the API refuses every other endpoint until it is.
      if (user.mustChangePassword) {
        await this.router.navigate(['/account/password'], { replaceUrl: true });
        return;
      }
      await this.router.navigateByUrl(homePathFor(user), { replaceUrl: true });
    } catch {
      // replaceUrl so Back does not return to a callback URL whose one-time
      // state has already been consumed.
      await this.router.navigate(['/login'], {
        replaceUrl: true,
        queryParams: { sso_error: this.transloco.translate('login.ssoIncomplete') },
      });
    }
  }
}
