import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  AuthApi,
  PublicApi,
  SessionStore,
  ThemeService,
  errorMessage,
  homePathFor,
  type User,
} from '@trackly/core';
import { Alert, Button, Icon, InputDirective, LabelDirective, Spinner } from '@trackly/ui';
import { AuthLayout } from './auth-layout';

type Phase = 'email' | 'code';

/**
 * Passwordless sign-in, in two phases on one screen: enter an email → enter the
 * 6-digit code from the email.
 *
 * If this installation has SSO configured we hand off to the IdP instead of
 * sending a link. A workspace-branded login (`?workspace=slug`) skips that — it
 * is a customer-facing surface — and wears the workspace's brand, forced to
 * light mode (invariant 6).
 *
 * Trackly has no password field and never will.
 */
@Component({
  selector: 'tk-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    AuthLayout,
    Alert,
    Button,
    Icon,
    InputDirective,
    LabelDirective,
    Spinner,
  ],
  template: `
    <tk-auth-layout
      [brandName]="brandName()"
      [logoUrl]="branding.value()?.logoUrl ?? null"
      [accent]="accent()"
      [panelTitle]="panelTitleKey() | transloco"
      [panelBody]="'login.panel.body' | transloco"
    >
      @switch (phase()) {
        <!-- ─────────── 1. Email ─────────── -->
        @case ('email') {
          <h1 class="font-display text-[30px] font-extrabold leading-tight tracking-tight">
            {{ headlineKey() | transloco: { name: brandName() } }}
          </h1>
          <p class="mt-2 text-[15px] text-muted-foreground">{{ subhead() }}</p>

          <form class="mt-8" (ngSubmit)="begin()">
            <label tkLabel for="email">{{ 'login.workEmail' | transloco }}</label>
            <input
              #emailInput
              tkInput
              id="email"
              name="email"
              type="email"
              autocomplete="email"
              [placeholder]="'login.emailPlaceholder' | transloco"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
            />

            @if (error(); as message) {
              <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
            }

            <button
              tkButton
              type="submit"
              size="lg"
              class="mt-5 w-full"
              [style.background]="accent()"
              [disabled]="!isValidEmail() || busy()"
            >
              @if (busy()) {
                <tk-spinner [size]="16" />
              }
              {{ (checkingSso() ? 'login.checkingSso' : 'login.continue') | transloco }}
            </button>
          </form>

          <p class="mt-4 text-meta leading-relaxed text-muted-foreground">
            {{ 'login.magicLinkHint' | transloco }}
          </p>
        }

        <!-- ─────────── 2. Code ─────────── -->
        @case ('code') {
          <button
            type="button"
            class="mb-6 inline-flex items-center gap-1.5 text-body text-muted-foreground hover:text-foreground"
            (click)="backToEmail()"
          >
            <tk-icon name="arrow-left" [size]="16" />
            {{ 'login.useDifferentEmail' | transloco }}
          </button>

          <h1 class="font-display text-[30px] font-extrabold leading-tight tracking-tight">
            {{ 'login.checkEmail' | transloco }}
          </h1>
          <p class="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            {{ 'login.sentTo' | transloco }}
            <span class="font-semibold text-foreground">{{ email() }}</span>.
            {{ 'login.linkExpires' | transloco }}
          </p>

          <form class="mt-8" (ngSubmit)="verify()">
            <label tkLabel for="code">{{ 'login.codeLabel' | transloco }}</label>
            <input
              #codeInput
              tkInput
              id="code"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="000000"
              class="text-center font-display text-[22px] font-bold tracking-[0.4em]"
              [ngModel]="code()"
              (ngModelChange)="onCode($event)"
            />

            @if (error(); as message) {
              <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
            }

            <button
              tkButton
              type="submit"
              size="lg"
              class="mt-5 w-full"
              [style.background]="accent()"
              [disabled]="code().length !== 6 || busy()"
            >
              @if (busy()) {
                <tk-spinner [size]="16" />
              }
              {{ 'login.verify' | transloco }}
            </button>
          </form>

          <p class="mt-5 text-body text-muted-foreground">
            {{ 'login.didntGetIt' | transloco }}
            <button
              type="button"
              class="font-semibold text-primary hover:underline disabled:opacity-50"
              [disabled]="busy()"
              (click)="send()"
            >
              {{ 'login.resend' | transloco }}
            </button>
          </p>
        }

      }

      <ng-container auth-footer>
        @if (accent() && !branding.value()?.hidePoweredBy) {
          <span>{{ 'common.poweredBy' | transloco }}</span>
        }
      </ng-container>
    </tk-auth-layout>
  `,
})
export class Login {
  private readonly auth = inject(AuthApi);
  private readonly publicApi = inject(PublicApi);
  private readonly session = inject(SessionStore);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  /** Re-resolve TS-side copy when the language changes. */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: null });

  /** Set when the visitor arrived from a workspace's branded link. */
  private readonly workspaceSlug = computed(() => this.query()?.get('workspace') ?? undefined);
  private readonly returnUrl = computed(() => this.query()?.get('returnUrl') ?? null);

  /** A branded login wears the workspace's identity; a miss falls back to Trackly's. */
  protected readonly branding = resource({
    params: () => ({ slug: this.workspaceSlug() }),
    loader: ({ params }) =>
      params.slug ? this.publicApi.branding(params.slug) : Promise.resolve(null),
  });

  protected readonly accent = computed(() => this.branding.value()?.primaryColor ?? null);
  protected readonly brandName = computed(() => this.branding.value()?.workspaceName ?? 'Trackly');

  protected readonly phase = signal<Phase>('email');
  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly checkingSso = signal(false);

  protected readonly isValidEmail = computed(() => /.+@.+\..+/.test(this.email()));

  /** One key per whole sentence; the workspace name travels as a parameter. */
  protected readonly headlineKey = computed(() =>
    this.branding.value()?.workspaceName ? 'login.signInTo' : 'login.signIn',
  );

  /**
   * A workspace's own `welcomeText` is admin-authored content, not UI copy, so
   * it is shown verbatim when set. Trackly's own default comes from a key.
   */
  protected readonly subhead = computed(() => {
    this.lang();
    return this.branding.value()?.welcomeText || this.transloco.translate('login.welcomeBack');
  });

  protected readonly panelTitleKey = computed(() => 'login.panel.signInTitle');

  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  constructor() {
    // A workspace-branded sign-in is a customer-facing surface: it wears the
    // tenant's colour and is always light. Restore the visitor's own preference
    // on the way out (invariant 6).
    let release: (() => void) | null = null;
    effect(() => {
      if (this.accent() && !release) release = this.theme.forceLight();
    });
    inject(DestroyRef).onDestroy(() => release?.());

    // Focus follows the phase, so the keyboard never has to catch up.
    effect(() => {
      const phase = this.phase();
      queueMicrotask(() => {
        if (phase === 'email') this.emailInput()?.nativeElement.focus();
        if (phase === 'code') this.codeInput()?.nativeElement.focus();
      });
    });
  }

  /** Digits only, and submit the moment the sixth arrives — no extra click. */
  protected onCode(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    this.code.set(digits);
    if (digits.length === 6 && !this.busy()) void this.verify();
  }

  protected backToEmail(): void {
    this.code.set('');
    this.error.set(null);
    this.phase.set('email');
  }

  protected async begin(): Promise<void> {
    if (!this.isValidEmail() || this.busy()) return;
    this.error.set(null);

    // A branded login is a customer-facing surface; customers are not the people
    // an IdP knows about, so it stays on the magic link.
    if (!this.workspaceSlug()) {
      this.checkingSso.set(true);
      this.busy.set(true);
      try {
        const discovery = await this.auth.discoverSso();
        if (discovery?.startUrl) {
          window.location.href = discovery.startUrl;
          return;
        }
      } finally {
        this.checkingSso.set(false);
        this.busy.set(false);
      }
    }

    await this.send();
  }

  protected async send(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.sendMagicLink(this.email(), this.workspaceSlug());
      this.code.set('');
      this.phase.set('code');
    } catch (err) {
      this.error.set(errorMessage(err, this.transloco.translate('login.sendFailed')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async verify(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.auth.verify({
        email: this.email(),
        code: this.code(),
        workspaceSlug: this.workspaceSlug(),
      });
      await this.complete(result.user);
    } catch (err) {
      this.error.set(errorMessage(err, this.transloco.translate('login.codeFailed')));
    } finally {
      this.busy.set(false);
    }
  }

  /** Adopts the session and routes by role, honouring where the user was headed. */
  private async complete(user: User): Promise<void> {
    this.session.set(user);
    await this.router.navigateByUrl(this.returnUrl() ?? homePathFor(user));
  }
}
