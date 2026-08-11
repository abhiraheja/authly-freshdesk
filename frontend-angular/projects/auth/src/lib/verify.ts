import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthApi, PublicApi, SessionStore, errorMessage, homePathFor, settled } from '@trackly/core';
import { Alert, Button, Spinner } from '@trackly/ui';
import { AuthLayout } from './auth-layout';

/**
 * Where an emailed sign-in link lands.
 *
 * <h3>The token is never consumed by arriving here</h3>
 * Invariant 7, and the entire reason this screen exists rather than a redirect
 * that just signs you in. Corporate mail scanners, link-preview bots and safety
 * services fetch every URL in an inbound message before the recipient sees it —
 * with a GET. If landing on this page spent the token, the real person would
 * arrive to a link that had already been used, and the failure would look like a
 * bug in Trackly rather than a scanner doing its job.
 *
 * So loading this page does nothing at all. Only the confirm button POSTs, and a
 * POST is the one thing a prefetching scanner will not do.
 *
 * <h3>Four states</h3>
 * No token in the URL (a truncated or mangled link — a different message from a
 * failure), ready to confirm, confirming, and failed with a way back. There is
 * deliberately no success state: a successful confirm navigates away.
 *
 * <h3>Same brand, same scheme, as `/login`</h3>
 * Branding loads whether or not the emailed link carried `?workspace=`, and the
 * visitor's light/dark preference is left alone — both to match the sign-in page
 * this person came from. When the two disagreed, the same flow appeared to hop
 * between two different products halfway through.
 */
@Component({
  selector: 'tk-verify',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, RouterLink, AuthLayout, Alert, Button, Spinner],
  template: `
    <tk-auth-layout
      [brandName]="brandName()"
      [logoUrl]="logoUrl()"
      [imageUrl]="signInImageUrl()"
      [accent]="accent()"
    >
      @if (!token()) {
        <!-- ── No token: the link itself is broken ─────────────────────── -->
        <h1 class="font-display text-title font-extrabold tracking-tight">
          {{ 'verify.invalidTitle' | transloco }}
        </h1>
        <p class="mt-2 text-body text-muted-foreground">
          {{ 'verify.invalidBody' | transloco }}
        </p>
        <a
          tkButton
          size="lg"
          class="mt-6 w-full"
          [style.background]="accent()"
          routerLink="/login"
          [queryParams]="{ workspace: workspaceSlug() }"
        >
          {{ 'verify.backToSignIn' | transloco }}
        </a>
      } @else {
        <!-- ── Ready to confirm ────────────────────────────────────────── -->
        <h1 class="font-display text-title font-extrabold tracking-tight">
          {{ 'verify.title' | transloco }}
        </h1>
        <p class="mt-2 text-body text-muted-foreground">
          {{ 'verify.body' | transloco }}
        </p>

        @if (error(); as message) {
          <tk-alert tone="danger" class="mt-4">
            {{ message }}
            <a routerLink="/login" [queryParams]="{ workspace: workspaceSlug() }" class="underline">
              {{ 'verify.requestNew' | transloco }}
            </a>
          </tk-alert>
        }

        <button
          tkButton
          type="button"
          size="lg"
          class="mt-6 w-full"
          [style.background]="accent()"
          [disabled]="busy()"
          (click)="confirm()"
        >
          @if (busy()) {
            <tk-spinner [size]="16" />
          }
          {{ 'verify.confirm' | transloco }}
        </button>
      }

      <ng-container auth-footer>
        @if (accent() && !hidePoweredBy()) {
          <span>{{ 'common.poweredBy' | transloco }}</span>
        }
      </ng-container>
    </tk-auth-layout>
  `,
})
export class Verify {
  private readonly auth = inject(AuthApi);
  private readonly publicApi = inject(PublicApi);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly token = computed(() => this.query()?.get('token') ?? null);
  protected readonly workspaceSlug = computed(() => this.query()?.get('workspace') ?? undefined);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * The workspace's identity, with or without a slug on the link.
   *
   * Three guards, all deliberate on a screen that must never fail to render:
   * `PublicApi.branding` swallows its own failure, the loader catches anything
   * that still escapes, and every read goes through `settled` — which is the
   * only one of the three that survives a future refactor of the other two.
   * `resource.value()` *throws* in the error state, so a workspace that no
   * longer resolves would blank the whole template, and this is the screen where
   * that costs someone their way in. Branding is decoration; sign-in is not.
   */
  private readonly branding = resource({
    params: () => ({ slug: this.workspaceSlug() }),
    loader: ({ params }) => this.publicApi.branding(params.slug).catch(() => null),
  });

  private readonly loaded = settled(() => this.branding);

  protected readonly accent = computed(() => this.loaded()?.primaryColor ?? null);
  protected readonly brandName = computed(() => this.loaded()?.workspaceName ?? 'Trackly');
  protected readonly logoUrl = computed(() => this.loaded()?.logoUrl ?? null);
  protected readonly signInImageUrl = computed(() => this.loaded()?.signInImageUrl ?? null);
  protected readonly hidePoweredBy = computed(() => this.loaded()?.hidePoweredBy ?? false);

  /** The only thing that spends the token, and only from a real click. */
  protected async confirm(): Promise<void> {
    const token = this.token();
    if (!token || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.auth.verify({ token, workspaceSlug: this.workspaceSlug() });
      this.session.set(result.user);

      // A temporary password gets replaced before anything else — the API
      // refuses every other endpoint until it is (invariant 9).
      if (result.user.mustChangePassword) {
        await this.router.navigate(['/account/password'], { replaceUrl: true });
        return;
      }
      await this.router.navigateByUrl(homePathFor(result.user), { replaceUrl: true });
    } catch (failure) {
      this.error.set(errorMessage(failure));
      this.busy.set(false);
    }
  }
}
