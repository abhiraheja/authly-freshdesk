import {
  ChangeDetectionStrategy,
  Component,
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
  errorMessage,
  homePathFor,
  settled,
  type User,
} from '@trackly/core';
import type { SsoLoginProvider } from '@trackly/core';
import { Alert, Button, Icon, InputDirective, LabelDirective, ProviderMark, Spinner } from '@trackly/ui';
import { AuthLayout } from './auth-layout';

type Phase = 'email' | 'code';

/**
 * Sign-in. Three ways in, on one screen: a button per configured identity
 * provider, email + password, and an emailed 6-digit code (the second phase).
 *
 * **The providers are buttons, not a redirect.** SSO used to be a fork inside
 * submit: one connection per workspace meant "has SSO" was a yes/no, and typing
 * an email just bounced you to the IdP. A workspace can now offer several, so
 * the choice has to be visible — and the password field stops disappearing on
 * installations that configured SSO for a subset of their people.
 *
 * Which providers appear is the server's call, from the workspace slug: a
 * branded login (`?workspace=slug`) is a customer-facing surface, so it gets the
 * customer-facing providers rather than the staff ones.
 *
 * **Branding loads with or without a slug.** It used to load only for `?workspace=`,
 * which meant a magic-link email — whose verify URL carries the slug — showed the
 * workspace's colours while the sign-in page the same person had just come from
 * showed Trackly's. One deployment is one workspace, so `/api/public/branding`
 * resolves it with no slug at all and both screens wear the same identity.
 *
 * **Dark mode stays.** Invariant 6 forces light on the portal, guest views, the
 * knowledge base, the widget, chat, CSAT and emails — sign-in is not in that list,
 * and staff sign in here too. So this screen takes the workspace's colour while
 * still honouring the visitor's own light/dark preference.
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
    ProviderMark,
    Spinner,
  ],
  template: `
    <tk-auth-layout
      [brandName]="brandName()"
      [logoUrl]="loadedBranding()?.logoUrl ?? null"
      [imageUrl]="loadedBranding()?.signInImageUrl ?? null"
      [accent]="accent()"
      [panelTitle]="panelTitle()"
      [panelBody]="'login.panel.body' | transloco"
    >
      @switch (phase()) {
        <!-- ─────────── 1. Email ─────────── -->
        @case ('email') {
          <h1 class="font-display text-[30px] font-extrabold leading-tight tracking-tight">
            {{ headlineKey() | transloco: { name: brandName() } }}
          </h1>
          <p class="mt-2 text-[15px] text-muted-foreground">{{ subhead() }}</p>

          <!-- One button per configured provider. The server has already picked
               which belong on this surface, so a branded customer login shows the
               customer-facing ones and Trackly's own shows the staff ones. -->
          @if (providers().length) {
            <div class="mt-8 space-y-2">
              @for (provider of providers(); track provider.id) {
                <button
                  tkButton
                  variant="outline"
                  size="lg"
                  type="button"
                  class="w-full"
                  [disabled]="busy()"
                  (click)="startSso(provider)"
                >
                  <tk-provider-mark [name]="provider.provider" [size]="18" />
                  {{ 'login.continueWith' | transloco: { provider: provider.providerName } }}
                </button>
              }
            </div>

            @if (nativeAvailable()) {
              <div class="my-6 flex items-center gap-3" aria-hidden="true">
                <span class="h-px flex-1 bg-border"></span>
                <span class="text-meta text-muted-foreground">{{ 'login.or' | transloco }}</span>
                <span class="h-px flex-1 bg-border"></span>
              </div>
            }
          }

          <!-- An admin can switch both native methods off once SSO is proven to
               work. Rendering a dead email box under the provider buttons would
               invite people to type into something with nothing behind it. -->
          @if (nativeAvailable()) {
          <form [class]="providers().length ? '' : 'mt-8'" (ngSubmit)="begin()">
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

            <!-- Password is the primary credential on a self-hosted install: it
                 is the only one that works before SMTP is configured, and SMTP
                 is configured from inside Trackly. Hidden only when the admin
                 has turned it off, or on a customer-branded surface. -->
            @if (passwordAvailable()) {
              <label tkLabel for="password" class="mt-5">{{ 'login.password' | transloco }}</label>
              <input
                #passwordInput
                tkInput
                id="password"
                name="password"
                type="password"
                autocomplete="current-password"
                [ngModel]="password()"
                (ngModelChange)="password.set($event)"
              />
            }

            @if (error(); as message) {
              <tk-alert tone="danger" class="mt-4">{{ message }}</tk-alert>
            }

            <button
              tkButton
              type="submit"
              size="lg"
              class="mt-5 w-full"
              [style.background]="accent()"
              [disabled]="!canSubmit() || busy()"
            >
              @if (busy()) {
                <tk-spinner [size]="16" />
              }
              {{ submitLabelKey() | transloco }}
            </button>
          </form>

          <!-- The second way in, and the only one when no password is set: an
               emailed code. Useless before SMTP exists, so it never replaces the
               password field — it sits under it. -->
          @if (emailAvailable()) {
            <p class="mt-5 text-body text-muted-foreground">
              @if (passwordAvailable()) {
                <button
                  type="button"
                  class="font-semibold text-primary hover:underline disabled:opacity-50"
                  [disabled]="!isValidEmail() || busy()"
                  (click)="send()"
                >
                  {{ 'login.emailMeACode' | transloco }}
                </button>
              } @else {
                {{ 'login.magicLinkHint' | transloco }}
              }
            </p>
          }
          } @else if (error(); as message) {
            <tk-alert tone="danger" class="mt-6">{{ message }}</tk-alert>
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
            <!-- maxlength is 7, not 6: onCode strips non-digits, but the
                 browser applies maxlength to a paste first, so a code copied
                 with a stray space or newline was cut to five digits and then
                 simply never verified. One spare character costs nothing. -->
            <input
              #codeInput
              tkInput
              id="code"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="7"
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
        @if (accent() && !loadedBranding()?.hidePoweredBy) {
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  /** Re-resolve TS-side copy when the language changes. */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: null });

  /** Set when the visitor arrived from a workspace's branded link. */
  private readonly workspaceSlug = computed(() => this.query()?.get('workspace') ?? undefined);
  private readonly returnUrl = computed(() => this.query()?.get('returnUrl') ?? null);

  /**
   * The workspace's identity, slug or no slug.
   *
   * Two guards, both deliberate on the one screen that must never fail to
   * render: `PublicApi.branding` swallows its own failure and answers null, and
   * every read goes through `loadedBranding` below. Branding is decoration;
   * sign-in is not, and the two must not share a failure.
   */
  protected readonly branding = resource({
    params: () => ({ slug: this.workspaceSlug() }),
    loader: ({ params }) => this.publicApi.branding(params.slug),
  });

  protected readonly accent = computed(() => this.loadedBranding()?.primaryColor ?? null);
  protected readonly brandName = computed(() => this.loadedBranding()?.workspaceName ?? 'Trackly');

  /**
   * Which methods to offer.
   *
   * The workspace slug travels with the call because it is also the audience:
   * the server returns the customer-facing providers for a branded surface and
   * the staff ones otherwise, so this screen never has to decide which buttons a
   * customer is allowed to see.
   */
  protected readonly methods = resource({
    params: () => ({ slug: this.workspaceSlug() }),
    loader: ({ params }) => this.auth.loginMethods(params.slug),
  });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedBranding = settled(() => this.branding);
  protected readonly loadedMethods = settled(() => this.methods);

  /** Already filtered for this surface by the server — render them all. */
  protected readonly providers = computed(() => this.loadedMethods()?.ssoProviders ?? []);

  protected readonly phase = signal<Phase>('email');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly code = signal('');
  private readonly localError = signal<string | null>(null);

  /**
   * A local failure, or the reason the provider sent us back.
   *
   * Every SSO dead end — a refused domain, an expired state, an IdP that said no
   * — redirects here with `?sso_error=`. Nothing read it before, so a failed
   * provider sign-in landed on a sign-in page that looked perfectly ordinary and
   * said nothing about what had just gone wrong.
   */
  protected readonly error = computed(() => this.localError() ?? this.query()?.get('sso_error') ?? null);
  protected readonly busy = signal(false);

  protected readonly isValidEmail = computed(() => /.+@.+\..+/.test(this.email()));

  /**
   * Defaults to true while the methods call is in flight, so the password field
   * does not appear a beat after the form — a field that pops in under the
   * cursor is worse than one that turns out to be unnecessary.
   */
  protected readonly passwordAvailable = computed(() => this.loadedMethods()?.passwordLoginEnabled ?? true);
  protected readonly emailAvailable = computed(() => this.loadedMethods()?.emailLoginEnabled ?? true);

  /**
   * Whether the email form is worth showing at all. Both native methods can be
   * off once SSO is proven — invariant 8 allows exactly that — and then the
   * providers are the entire sign-in page.
   */
  protected readonly nativeAvailable = computed(() => this.passwordAvailable() || this.emailAvailable());

  protected readonly canSubmit = computed(() => {
    if (!this.isValidEmail()) return false;
    return this.passwordAvailable() ? this.password().length > 0 : true;
  });

  protected readonly submitLabelKey = computed(() =>
    this.passwordAvailable() ? 'login.signInAction' : 'login.continue',
  );

  /** One key per whole sentence; the workspace name travels as a parameter. */
  protected readonly headlineKey = computed(() =>
    this.loadedBranding()?.workspaceName ? 'login.signInTo' : 'login.signIn',
  );

  /**
   * A workspace's own `welcomeText` is admin-authored content, not UI copy, so
   * it is shown verbatim when set. Trackly's own default comes from a key.
   */
  protected readonly subhead = computed(() => {
    this.lang();
    return this.loadedBranding()?.welcomeText || this.transloco.translate('login.welcomeBack');
  });

  /**
   * The headline across the panel.
   *
   * A workspace's own `pageTitle` wins — it is admin-authored content, the
   * branding screen's own help text calls it "the headline on the sign-in
   * panel", and its preview renders it there. Falling back to Trackly's line
   * when one is set made the preview a lie.
   */
  protected readonly panelTitle = computed(() => {
    this.lang();
    return this.loadedBranding()?.pageTitle || this.transloco.translate('login.panel.signInTitle');
  });

  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  constructor() {
    // No `forceLight()` here, deliberately. The colour is the workspace's; the
    // scheme is the visitor's — see the class doc.

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
    this.localError.set(null);
    this.phase.set('email');
  }

  /**
   * Hands off to the IdP.
   *
   * A full-page navigation, not a fetch: the whole point of the redirect dance is
   * that the browser visits the provider, and the session cookie comes back from
   * Trackly's own callback rather than from anything this page holds.
   */
  protected startSso(provider: SsoLoginProvider): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.localError.set(null);
    window.location.href = provider.startUrl;
  }

  protected async begin(): Promise<void> {
    if (!this.canSubmit() || this.busy()) return;
    this.localError.set(null);

    if (this.passwordAvailable()) {
      await this.signInWithPassword();
      return;
    }

    await this.send();
  }

  private async signInWithPassword(): Promise<void> {
    this.busy.set(true);
    this.localError.set(null);
    try {
      const { user } = await this.auth.passwordLogin({
        email: this.email(),
        password: this.password(),
        workspaceSlug: this.workspaceSlug(),
      });
      await this.complete(user);
    } catch (err) {
      this.localError.set(errorMessage(err, this.transloco.translate('login.passwordFailed')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async send(): Promise<void> {
    this.busy.set(true);
    this.localError.set(null);
    try {
      await this.auth.sendMagicLink(this.email(), this.workspaceSlug());
      this.code.set('');
      this.phase.set('code');
    } catch (err) {
      this.localError.set(errorMessage(err, this.transloco.translate('login.sendFailed')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async verify(): Promise<void> {
    this.busy.set(true);
    this.localError.set(null);
    try {
      const result = await this.auth.verify({
        email: this.email(),
        code: this.code(),
        workspaceSlug: this.workspaceSlug(),
      });
      await this.complete(result.user);
    } catch (err) {
      this.localError.set(errorMessage(err, this.transloco.translate('login.codeFailed')));
    } finally {
      this.busy.set(false);
    }
  }

  /** Adopts the session and routes by role, honouring where the user was headed. */
  private async complete(user: User): Promise<void> {
    this.session.set(user);
    // A temporary password gets replaced before anything else. The API refuses
    // every other endpoint until it is, so sending them anywhere else would just
    // produce a screen full of 403s.
    if (user.mustChangePassword) {
      await this.router.navigate(['/account/password'], {
        queryParams: this.returnUrl() ? { returnUrl: this.returnUrl() } : undefined,
      });
      return;
    }
    await this.router.navigateByUrl(this.returnUrl() ?? homePathFor(user));
  }
}
