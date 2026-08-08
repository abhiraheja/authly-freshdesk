import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthApi, SessionStore, errorMessage, homePathFor } from '@trackly/core';
import { Alert, Button, InputDirective, LabelDirective, Spinner } from '@trackly/ui';
import { AuthLayout } from './auth-layout';

/** Kept in step with PasswordPolicy on the server; the server is the authority. */
const MIN_LENGTH = 12;

/**
 * Change your own password — reached voluntarily from the profile menu, and
 * forced after signing in with a temporary one an admin issued.
 *
 * In the forced case there is deliberately no way past this screen: the API
 * refuses every other endpoint while the flag is set, so an escape hatch here
 * would only lead to a wall of 403s.
 */
@Component({
  selector: 'tk-change-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslocoPipe, AuthLayout, Alert, Button, InputDirective, LabelDirective, Spinner],
  template: `
    <tk-auth-layout
      [panelTitle]="'password.panel.title' | transloco"
      [panelBody]="'password.panel.body' | transloco"
    >
      <h1 class="font-display text-[30px] font-extrabold leading-tight tracking-tight">
        {{ (forced() ? 'password.forcedTitle' : 'password.title') | transloco }}
      </h1>
      <p class="mt-2 text-[15px] text-muted-foreground">
        {{ (forced() ? 'password.forcedSubtitle' : 'password.subtitle') | transloco }}
      </p>

      <form class="mt-8" (ngSubmit)="submit()">
        <label tkLabel for="current">{{ 'password.current' | transloco }}</label>
        <input
          tkInput
          id="current"
          name="current"
          type="password"
          autocomplete="current-password"
          [ngModel]="current()"
          (ngModelChange)="current.set($event)"
        />

        <label tkLabel for="next" class="mt-5">{{ 'password.new' | transloco }}</label>
        <input
          tkInput
          id="next"
          name="next"
          type="password"
          autocomplete="new-password"
          [ngModel]="next()"
          (ngModelChange)="next.set($event)"
        />
        <p class="mt-1.5 text-meta text-muted-foreground">
          {{ 'password.rule' | transloco: { min: minLength } }}
        </p>

        <label tkLabel for="confirm" class="mt-5">{{ 'password.confirm' | transloco }}</label>
        <input
          tkInput
          id="confirm"
          name="confirm"
          type="password"
          autocomplete="new-password"
          [ngModel]="confirm()"
          (ngModelChange)="confirm.set($event)"
        />
        @if (mismatch()) {
          <p class="mt-1.5 text-meta text-danger">{{ 'password.mismatch' | transloco }}</p>
        }

        @if (error(); as message) {
          <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
        }

        <button tkButton type="submit" size="lg" class="mt-6 w-full" [disabled]="!isValid() || busy()">
          @if (busy()) {
            <tk-spinner [size]="16" />
          }
          {{ 'password.submit' | transloco }}
        </button>
      </form>
    </tk-auth-layout>
  `,
})
export class ChangePassword {
  private readonly auth = inject(AuthApi);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly minLength = MIN_LENGTH;
  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly confirm = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  /** Arrived here because the API says so, not because they chose to. */
  protected readonly forced = computed(() => this.session.user()?.mustChangePassword ?? false);

  protected readonly mismatch = computed(
    () => this.confirm().length > 0 && this.next() !== this.confirm(),
  );

  protected readonly isValid = computed(
    () => this.current().length > 0 && this.next().length >= MIN_LENGTH && this.next() === this.confirm(),
  );

  protected async submit(): Promise<void> {
    if (!this.isValid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.changePassword(this.current(), this.next());
      // Re-read rather than patching the local copy: mustChangePassword is
      // decided by the server, and this screen's whole job was to clear it.
      const user = await this.session.reload();
      const returnUrl = this.query()?.get('returnUrl');
      await this.router.navigateByUrl(returnUrl ?? (user ? homePathFor(user) : '/login'));
    } catch (err) {
      this.error.set(errorMessage(err, this.transloco.translate('password.failed')));
    } finally {
      this.busy.set(false);
    }
  }
}
