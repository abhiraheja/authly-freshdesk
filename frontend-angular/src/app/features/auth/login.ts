import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthApi } from '../../core/auth/auth.api';
import { homePathFor, type User, type WorkspaceSummary } from '../../core/auth/auth.models';
import { SessionStore } from '../../core/auth/session.store';
import { errorMessage } from '../../core/api/api-error';
import { Alert, Button, Icon, InputDirective, LabelDirective, Spinner } from '../../ui';

type Phase = 'email' | 'code' | 'choose';

/**
 * Passwordless sign-in, in three phases on one screen: enter an email → enter
 * the 6-digit code from the email → (rarely) pick which workspace.
 *
 * On the Trackly-wide login the email's domain is checked for SSO first; if the
 * domain routes to a workspace's IdP we hand off there instead of emailing a
 * link. A branded per-workspace login (`?workspace=slug`) skips discovery — the
 * workspace is already known.
 *
 * Trackly has no password field and never will.
 */
@Component({
  selector: 'tk-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Alert, Button, Icon, InputDirective, LabelDirective, Spinner],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div class="w-full max-w-[520px]">
        <div class="mb-6 flex items-center justify-center gap-2.5">
          <div class="brand-gradient grid size-8 place-items-center rounded-lg text-white">
            <tk-icon name="life-buoy" [size]="17" />
          </div>
          <span class="font-display text-section font-extrabold">Trackly</span>
        </div>

        <div class="card p-6 sm:p-10">
          @switch (phase()) {
            <!-- ── 1. Email ─────────────────────────────────────────── -->
            @case ('email') {
              <h1 class="text-center font-display text-section font-extrabold">
                {{ isSignup() ? 'Create your account' : 'Sign in to Trackly' }}
              </h1>
              <p class="mb-8 mt-1.5 text-center text-body text-muted-foreground">
                {{
                  isSignup()
                    ? "You'll be the administrator of your new workspace. No password needed — ever."
                    : 'Welcome back. No password needed — ever.'
                }}
              </p>

              <form (ngSubmit)="begin()">
                <label tkLabel for="email">Work email</label>
                <input
                  tkInput
                  id="email"
                  type="email"
                  autocomplete="email"
                  placeholder="you@company.com"
                  [(ngModel)]="email"
                  name="email"
                  required
                  autofocus
                />

                @if (error(); as message) {
                  <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
                }

                <button
                  tkButton
                  type="submit"
                  size="lg"
                  class="mt-6 w-full"
                  [disabled]="!isValidEmail() || busy()"
                >
                  @if (busy()) {
                    <tk-spinner [size]="16" />
                  }
                  {{ checkingSso() ? 'Checking…' : 'Continue' }}
                </button>
              </form>

              <p class="mt-4 text-center text-meta text-muted-foreground">
                We'll send a magic link and a 6-digit code. Click the link or type the code.
              </p>

              <p class="mt-6 text-center text-body">
                @if (isSignup()) {
                  Already have a workspace?
                  <a routerLink="/login" class="font-semibold text-primary hover:underline">Sign in</a>
                } @else {
                  New to Trackly?
                  <a routerLink="/signup" class="font-semibold text-primary hover:underline">Start free</a>
                }
              </p>
            }

            <!-- ── 2. Code ──────────────────────────────────────────── -->
            @case ('code') {
              <h1 class="text-center font-display text-section font-extrabold">Check your email</h1>
              <p class="mb-8 mt-1.5 text-center text-body text-muted-foreground">
                We sent a sign-in link and a 6-digit code to <b class="text-foreground">{{ email() }}</b
                >. The link expires in 10 minutes.
              </p>

              <form (ngSubmit)="verify()">
                <label tkLabel for="code">Code from the email</label>
                <input
                  tkInput
                  id="code"
                  name="code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  placeholder="000000"
                  class="text-center font-display tracking-[0.5em]"
                  [(ngModel)]="code"
                  autofocus
                />

                @if (error(); as message) {
                  <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
                }

                <button
                  tkButton
                  type="submit"
                  size="lg"
                  class="mt-6 w-full"
                  [disabled]="code().length !== 6 || busy()"
                >
                  @if (busy()) {
                    <tk-spinner [size]="16" />
                  }
                  Verify
                </button>
              </form>

              <div class="mt-4 text-center">
                <button
                  type="button"
                  class="text-body text-muted-foreground hover:text-foreground hover:underline"
                  [disabled]="busy()"
                  (click)="send()"
                >
                  Resend email
                </button>
              </div>
            }

            <!-- ── 3. Choose a workspace ────────────────────────────── -->
            @case ('choose') {
              <h1 class="text-center font-display text-section font-extrabold">Choose a workspace</h1>
              <p class="mb-8 mt-1.5 text-center text-body text-muted-foreground">
                Your email belongs to more than one workspace.
              </p>

              <div class="space-y-2">
                @for (workspace of workspaces(); track workspace.slug) {
                  <button
                    type="button"
                    class="w-full rounded-xl border border-border p-4 text-left transition-colors hover:border-primary hover:bg-accent"
                    [disabled]="busy()"
                    (click)="verify(workspace.slug)"
                  >
                    <span class="block font-semibold">{{ workspace.name }}</span>
                    <span class="block text-meta text-muted-foreground">{{ workspace.slug }}</span>
                  </button>
                }
              </div>

              @if (error(); as message) {
                <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
              }
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class Login {
  private readonly auth = inject(AuthApi);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly routeData = toSignal(this.route.data, { initialValue: {} as Record<string, unknown> });
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly isSignup = computed(() => this.routeData()['mode'] === 'signup');
  /** Set when the visitor arrived from a workspace's branded link. */
  private readonly workspaceSlug = computed(() => this.query()?.get('workspace') ?? undefined);
  private readonly returnUrl = computed(() => this.query()?.get('returnUrl') ?? null);

  protected readonly phase = signal<Phase>('email');
  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly workspaces = signal<readonly WorkspaceSummary[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly checkingSso = signal(false);

  protected readonly isValidEmail = computed(() => /.+@.+\..+/.test(this.email()));

  protected async begin(): Promise<void> {
    if (!this.isValidEmail() || this.busy()) return;
    this.error.set(null);

    // Branded logins already know their workspace, so discovery would be noise.
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
      this.error.set(errorMessage(err, 'That code did not work. Try again or resend the email.'));
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
