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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AuthApi,
  PublicApi,
  SessionStore,
  ThemeService,
  errorMessage,
  homePathFor,
  type User,
  type WorkspaceSummary,
} from '@trackly/core';
import { Alert, Button, Icon, InputDirective, LabelDirective, Spinner } from '@trackly/ui';
import { AuthLayout } from './auth-layout';

type Phase = 'email' | 'code' | 'choose';

/**
 * Passwordless sign-in, in three phases on one screen: enter an email → enter
 * the 6-digit code from the email → (rarely) pick which workspace.
 *
 * On Trackly's own login the email's domain is checked for SSO first; if it
 * routes to a workspace's IdP we hand off there instead of sending a link. A
 * workspace-branded login (`?workspace=slug`) skips discovery — the workspace is
 * already known — and wears that workspace's brand, forced to light mode
 * (invariant 6).
 *
 * Trackly has no password field and never will.
 */
@Component({
  selector: 'tk-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
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
      [panelTitle]="panelTitle()"
    >
      @switch (phase()) {
        <!-- ─────────── 1. Email ─────────── -->
        @case ('email') {
          <h1 class="font-display text-[30px] font-extrabold leading-tight tracking-tight">
            {{ headline() }}
          </h1>
          <p class="mt-2 text-[15px] text-muted-foreground">{{ subhead() }}</p>

          <form class="mt-8" (ngSubmit)="begin()">
            <label tkLabel for="email">Work email</label>
            <input
              #emailInput
              tkInput
              id="email"
              name="email"
              type="email"
              autocomplete="email"
              placeholder="you@company.com"
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
              {{ checkingSso() ? 'Checking your organisation…' : 'Continue' }}
            </button>
          </form>

          <p class="mt-4 text-meta leading-relaxed text-muted-foreground">
            We'll email a sign-in link and a 6-digit code. Click the link or type
            the code — there's no password to remember.
          </p>

          <!-- Never advertise Trackly on a workspace's own sign-in page. -->
          @if (!accent()) {
            <p class="mt-8 text-body">
              @if (isSignup()) {
                Already have a workspace?
                <a routerLink="/login" class="font-semibold text-primary hover:underline">Sign in</a>
              } @else {
                New to Trackly?
                <a routerLink="/signup" class="font-semibold text-primary hover:underline">Start free</a>
              }
            </p>
          }
        }

        <!-- ─────────── 2. Code ─────────── -->
        @case ('code') {
          <button
            type="button"
            class="mb-6 inline-flex items-center gap-1.5 text-body text-muted-foreground hover:text-foreground"
            (click)="backToEmail()"
          >
            <tk-icon name="arrow-left" [size]="16" />
            Use a different email
          </button>

          <h1 class="font-display text-[30px] font-extrabold leading-tight tracking-tight">
            Check your email
          </h1>
          <p class="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            We sent a sign-in link and a 6-digit code to
            <span class="font-semibold text-foreground">{{ email() }}</span
            >. The link expires in 10 minutes.
          </p>

          <form class="mt-8" (ngSubmit)="verify()">
            <label tkLabel for="code">Code from the email</label>
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
              Verify and continue
            </button>
          </form>

          <p class="mt-5 text-body text-muted-foreground">
            Didn't get it?
            <button
              type="button"
              class="font-semibold text-primary hover:underline disabled:opacity-50"
              [disabled]="busy()"
              (click)="send()"
            >
              Resend the email
            </button>
          </p>
        }

        <!-- ─────────── 3. Choose a workspace ─────────── -->
        @case ('choose') {
          <h1 class="font-display text-[30px] font-extrabold leading-tight tracking-tight">
            Choose a workspace
          </h1>
          <p class="mt-2 text-[15px] text-muted-foreground">
            {{ email() }} belongs to more than one workspace.
          </p>

          <div class="mt-8 space-y-2">
            @for (workspace of workspaces(); track workspace.slug) {
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-accent disabled:opacity-50"
                [disabled]="busy()"
                (click)="verify(workspace.slug)"
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-semibold">{{ workspace.name }}</span>
                  <span class="block truncate text-meta text-muted-foreground">{{ workspace.slug }}</span>
                </span>
                <tk-icon name="chevron-right" [size]="16" class="shrink-0 text-muted-foreground" />
              </button>
            }
          </div>

          @if (error(); as message) {
            <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
          }
        }
      }

      <ng-container auth-footer>
        @if (accent() && !branding.value()?.hidePoweredBy) {
          <span>Powered by Trackly</span>
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

  private readonly routeData = toSignal(this.route.data, {
    initialValue: {} as Record<string, unknown>,
  });
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly isSignup = computed(() => this.routeData()['mode'] === 'signup');
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
  protected readonly workspaces = signal<readonly WorkspaceSummary[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly checkingSso = signal(false);

  protected readonly isValidEmail = computed(() => /.+@.+\..+/.test(this.email()));

  protected readonly headline = computed(() => {
    if (this.isSignup()) return 'Create your account';
    const name = this.branding.value()?.workspaceName;
    return name ? `Sign in to ${name}` : 'Sign in to Trackly';
  });

  protected readonly subhead = computed(() => {
    if (this.isSignup()) return "You'll be the administrator of your new workspace.";
    return this.branding.value()?.welcomeText || 'Track your support requests in one place.';
  });

  protected readonly panelTitle = computed(() =>
    this.isSignup() ? 'Your support desk, running today.' : 'Every conversation, in one place.',
  );

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

    // Branded logins already know their workspace, so discovery is noise there.
    if (!this.workspaceSlug()) {
      this.checkingSso.set(true);
      this.busy.set(true);
      try {
        const discovery = await this.auth.discoverSso(this.email());
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
      this.error.set(errorMessage(err, 'Could not send the sign-in email.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async verify(workspaceSlug?: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.auth.verify({
        email: this.email(),
        code: this.code(),
        workspaceSlug: workspaceSlug ?? this.workspaceSlug(),
      });

      switch (result.status) {
        case 'ok':
          await this.complete(result.user);
          break;
        case 'choose_workspace':
          this.workspaces.set(result.workspaces);
          this.phase.set('choose');
          break;
        case 'signup_required':
          await this.router.navigate(['/onboarding/workspace'], {
            state: { email: result.email, code: this.code() },
          });
          break;
      }
    } catch (err) {
      this.error.set(errorMessage(err, 'That code did not work. Try again, or resend the email.'));
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
