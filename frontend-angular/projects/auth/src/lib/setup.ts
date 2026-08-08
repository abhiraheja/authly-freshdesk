import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthApi, SessionStore, errorMessage, homePathFor } from '@trackly/core';
import { Alert, Button, InputDirective, LabelDirective, Spinner } from '@trackly/ui';
import { AuthLayout } from './auth-layout';

/**
 * First run. Shown only on an installation whose database has no workspace yet.
 *
 * **This signs the operator straight in — it does not email a link.** On a fresh
 * install SMTP has not been configured, and SMTP is configured from inside the
 * admin UI. Mailing someone their own way in would brick the one step that has
 * no way out. Whoever reaches this screen is the person who started the
 * container; there is nobody else to authenticate them against, and nothing to
 * protect yet.
 *
 * It stops existing the moment it succeeds: the API answers 409 from then on,
 * and the route guard sends visitors to /login instead.
 */
@Component({
  selector: 'tk-setup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    AuthLayout,
    Alert,
    Button,
    InputDirective,
    LabelDirective,
    Spinner,
  ],
  template: `
    <tk-auth-layout
      [panelTitle]="'setup.panel.title' | transloco"
      [panelBody]="'setup.panel.body' | transloco"
    >
      <h1 class="font-display text-[30px] font-extrabold leading-tight tracking-tight">
        {{ 'setup.title' | transloco }}
      </h1>
      <p class="mt-2 text-[15px] text-muted-foreground">{{ 'setup.subtitle' | transloco }}</p>

      <form class="mt-8" (ngSubmit)="submit()">
        <label tkLabel for="organisation">{{ 'setup.organisation' | transloco }}</label>
        <input
          #organisationInput
          tkInput
          id="organisation"
          name="organisation"
          autocomplete="organization"
          [placeholder]="'setup.organisationPlaceholder' | transloco"
          [ngModel]="organisation()"
          (ngModelChange)="organisation.set($event)"
        />
        <p class="mt-1.5 text-meta text-muted-foreground">{{ 'setup.organisationHint' | transloco }}</p>

        <label tkLabel for="email" class="mt-5">{{ 'setup.email' | transloco }}</label>
        <input
          tkInput
          id="email"
          name="email"
          type="email"
          autocomplete="email"
          [placeholder]="'login.emailPlaceholder' | transloco"
          [ngModel]="email()"
          (ngModelChange)="email.set($event)"
        />
        <p class="mt-1.5 text-meta text-muted-foreground">{{ 'setup.emailHint' | transloco }}</p>

        <label tkLabel for="name" class="mt-5">{{ 'setup.name' | transloco }}</label>
        <input
          tkInput
          id="name"
          name="name"
          autocomplete="name"
          [ngModel]="name()"
          (ngModelChange)="name.set($event)"
        />

        @if (error(); as message) {
          <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
        }

        <button tkButton type="submit" size="lg" class="mt-6 w-full" [disabled]="!isValid() || busy()">
          @if (busy()) {
            <tk-spinner [size]="16" />
          }
          {{ 'setup.submit' | transloco }}
        </button>
      </form>

      <p class="mt-4 text-meta leading-relaxed text-muted-foreground">{{ 'setup.footnote' | transloco }}</p>
    </tk-auth-layout>
  `,
})
export class Setup {
  private readonly auth = inject(AuthApi);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly organisation = signal('');
  protected readonly email = signal('');
  protected readonly name = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly isValid = computed(
    () => this.organisation().trim().length > 0 && /.+@.+\..+/.test(this.email()),
  );

  private readonly organisationInput = viewChild<ElementRef<HTMLInputElement>>('organisationInput');

  constructor() {
    // Same shape as the login screen: the microtask lets the view settle before
    // the focus lands.
    effect(() => {
      const input = this.organisationInput();
      queueMicrotask(() => input?.nativeElement.focus());
    });
  }

  protected async submit(): Promise<void> {
    if (!this.isValid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { user } = await this.auth.setup({
        organisationName: this.organisation().trim(),
        email: this.email().trim(),
        name: this.name().trim() || undefined,
      });
      this.session.set(user);
      await this.router.navigateByUrl(homePathFor(user));
    } catch (err) {
      // A 409 here means someone else claimed the installation while this form
      // was open. Saying so beats a generic failure, because the fix is to sign
      // in rather than to try again.
      this.error.set(errorMessage(err, this.transloco.translate('setup.failed')));
    } finally {
      this.busy.set(false);
    }
  }
}
