import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router, type Params } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EmailApi, errorMessage } from '@trackly/core';
import { Spinner } from '@trackly/ui';

/**
 * `/oauth/callback` — where Google, Microsoft and Yahoo send the browser back
 * after an admin consents to a mail connection.
 *
 * A **front-end** route rather than an API one, so the address registered in the
 * provider's console is the app's own and owes nothing to how the API happens to
 * be hosted. The page itself is a redirect with a spinner: it hands the `code`
 * and `state` to the server, then leaves. Nothing is rendered from the query
 * string — the outcome is reported by the email settings screen, which reads it
 * back from the server.
 *
 * Deliberately outside the shell and unguarded. An expired session here should
 * surface as the failure it is, not as a guard silently swallowing a consent the
 * admin just granted; the POST 401s and the redirect below lands on a guarded
 * route that sends them to sign in.
 */
@Component({
  selector: 'tk-email-oauth-callback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Spinner],
  template: `
    <div class="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <tk-spinner [size]="28" />
      <p class="text-body text-muted-foreground">{{ 'admin.email.finishing' | transloco }}</p>
    </div>
  `,
})
export class EmailOAuthCallback {
  private readonly api = inject(EmailApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);

  constructor() {
    void this.finish();
  }

  private async finish(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const state = params.get('state');
    const code = params.get('code');

    // The provider can bounce back with a refusal instead of a code — an admin
    // who clicked Cancel, or a consent screen that rejected the scope.
    const refused = params.get('error_description') ?? params.get('error');
    if (refused) {
      await this.back({ email_error: refused });
      return;
    }

    if (!state || !code) {
      await this.back({ email_error: this.transloco.translate('admin.email.connectIncomplete') });
      return;
    }

    try {
      const { provider } = await this.api.completeConnect(state, code);
      await this.back({ connected: provider });
    } catch (error) {
      await this.back({ email_error: errorMessage(error) });
    }
  }

  /**
   * `replaceUrl` on purpose: this URL carries a code that has just been spent.
   * Leaving it in history invites a Back button or a refresh into replaying a
   * handshake that can only fail.
   */
  private back(queryParams: Params): Promise<boolean> {
    return this.router.navigate(['/admin/settings/email'], { queryParams, replaceUrl: true });
  }
}
