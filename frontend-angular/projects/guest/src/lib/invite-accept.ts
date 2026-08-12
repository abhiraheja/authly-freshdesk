import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ApiError,
  PublicApi,
  SessionStore,
  errorMessage,
  homePathFor,
  settled,
} from '@trackly/core';
import {
  Alert,
  BrandedFrame,
  Button,
  Card,
  Icon,
  InputDirective,
  LabelDirective,
  SkeletonDirective,
  Spinner,
} from '@trackly/ui';

/**
 * `/invite/:token` — where an emailed join link lands.
 *
 * Workspace-branded and always light (invariant 6): whoever opens this has no
 * Trackly account yet, so the only identity that means anything to them is the
 * organisation that invited them.
 *
 * **The token is read, never spent, on arrival.** Loading the page is a GET that
 * only describes the invitation; accepting is a POST. That split is invariant 7,
 * and it is not theoretical — corporate mail scanners fetch every link in an
 * incoming message, and a GET that consumed the token would burn the invitation
 * before the recipient ever clicked it.
 *
 * Four ways this can end, and each says which one it is: the link is not valid,
 * it has expired, it was already used, or it works. "Expired" and "already used"
 * are deliberately distinct from "not valid" — one means ask for another, the
 * other means you already have an account, and collapsing them into one error
 * sends people to the wrong place.
 */
@Component({
  selector: 'tk-invite-accept',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    BrandedFrame,
    Button,
    Card,
    Icon,
    InputDirective,
    LabelDirective,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <tk-branded-frame
      [brandName]="brandName()"
      [logoUrl]="loadedBranding()?.logoUrl ?? null"
      [accent]="accent()"
      [footerText]="loadedBranding()?.footerText ?? ''"
      [hidePoweredBy]="loadedBranding()?.hidePoweredBy ?? false"
      [maxWidth]="560"
    >
      @if (loadedInvite(); as info) {
        <tk-card>
          @if (info.accepted) {
            <div class="space-y-3 py-2 text-center">
              <tk-icon name="check-circle" [size]="28" class="text-success" />
              <h1 class="font-display text-section font-bold">{{ 'invite.acceptedHeading' | transloco }}</h1>
              <p class="text-body text-muted-foreground">{{ 'invite.acceptedBody' | transloco }}</p>
              <a tkButton routerLink="/login">{{ 'invite.signIn' | transloco }}</a>
            </div>
          } @else if (info.expired) {
            <div class="space-y-3 py-2 text-center">
              <tk-icon name="clock" [size]="28" class="text-warning" />
              <h1 class="font-display text-section font-bold">{{ 'invite.expiredHeading' | transloco }}</h1>
              <p class="text-body text-muted-foreground">
                {{ 'invite.expiredBody' | transloco: { workspace: info.workspaceName } }}
              </p>
            </div>
          } @else {
            <div class="space-y-4">
              <header>
                <h1 class="font-display text-page font-extrabold">
                  {{ 'invite.title' | transloco: { workspace: info.workspaceName } }}
                </h1>
                <p class="mt-1 text-body text-muted-foreground">
                  @if (info.invitedBy) {
                    {{ 'invite.body' | transloco: { inviter: info.invitedBy, role: 'roles.' + info.role | transloco } }}
                  } @else {
                    {{ 'invite.bodyNoInviter' | transloco: { role: 'roles.' + info.role | transloco } }}
                  }
                </p>
              </header>

              <!-- The address is shown because it is not negotiable: the account
                   is created for the address the invitation was issued to, even
                   if the mail was forwarded to a different inbox. -->
              <div class="rounded-xl bg-muted px-3.5 py-3">
                <p class="text-meta text-muted-foreground">{{ 'invite.emailLabel' | transloco }}</p>
                <p class="text-body font-semibold">{{ info.email }}</p>
              </div>

              <div>
                <label tkLabel for="invite-name">{{ 'invite.nameLabel' | transloco }}</label>
                <input
                  tkInput
                  id="invite-name"
                  name="invite-name"
                  autocomplete="name"
                  [(ngModel)]="name"
                  (keydown.enter)="accept()"
                />
                <p class="mt-1.5 text-meta text-muted-foreground">{{ 'invite.nameHint' | transloco }}</p>
              </div>

              @if (error(); as message) {
                <tk-alert tone="danger" [heading]="'invite.failed' | transloco">{{ message }}</tk-alert>
              }

              <button tkButton class="w-full" [disabled]="busy()" (click)="accept()">
                @if (busy()) {
                  <tk-spinner [size]="16" />
                }
                {{ 'invite.accept' | transloco }}
              </button>
            </div>
          }
        </tk-card>
      } @else if (invitation.error(); as failure) {
        <tk-card>
          <div class="space-y-3 py-2 text-center">
            <tk-icon name="alert-circle" [size]="28" class="text-danger" />
            <h1 class="font-display text-section font-bold">
              {{ (notFound() ? 'invite.invalidHeading' : 'invite.loadFailedHeading') | transloco }}
            </h1>
            <p class="text-body text-muted-foreground">
              {{ notFound() ? ('invite.invalidBody' | transloco) : loadError() }}
            </p>
            <!-- Retry only where retrying can help. A token the server does not
                 know will not become known by asking again. -->
            @if (notFound()) {
              <a tkButton variant="outline" routerLink="/login">{{ 'invite.signIn' | transloco }}</a>
            } @else {
              <button tkButton variant="outline" (click)="invitation.reload()">{{ 'common.retry' | transloco }}</button>
            }
          </div>
        </tk-card>
      } @else {
        <tk-card>
          <div class="space-y-3">
            <span tkSkeleton class="block h-7 w-2/3"></span>
            <span tkSkeleton class="block h-5 w-full"></span>
            <span tkSkeleton class="block h-16 w-full"></span>
            <span tkSkeleton class="block h-10 w-full"></span>
          </div>
        </tk-card>
      }
    </tk-branded-frame>
  `,
})
export class InviteAccept {
  /** The `:token` path segment, bound by `withComponentInputBinding()`. */
  readonly token = input('');

  private readonly publicApi = inject(PublicApi);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  /**
   * No slug: one deployment holds one workspace, and the person reading this has
   * no way to know the slug anyway. The server resolves it (invariant 1).
   */
  protected readonly branding = resource({ loader: () => this.publicApi.branding() });

  protected readonly invitation = resource({
    params: () => ({ token: this.token() }),
    loader: ({ params }) => this.publicApi.invitation(params.token),
  });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedBranding = settled(() => this.branding);
  protected readonly loadedInvite = settled(() => this.invitation);

  protected readonly brandName = computed(
    () => this.loadedBranding()?.workspaceName ?? this.loadedInvite()?.workspaceName ?? '',
  );
  protected readonly accent = computed(() => this.loadedBranding()?.primaryColor ?? null);

  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly loadError = computed(() => errorMessage(this.invitation.error()));

  /**
   * Branch on the status code, never the message — the copy will change and the
   * code will not. 404 is the server saying no such token; anything else is the
   * server being unreachable or broken, which is worth another try.
   */
  protected readonly notFound = computed(() => {
    const failure = this.invitation.error();
    return failure instanceof ApiError && failure.status === 404;
  });

  protected async accept(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.publicApi.acceptInvitation(this.token(), this.name().trim() || undefined);
      // Adopt the session the accept just issued, skipping a `/me` round-trip.
      this.session.set(result.user);
      await this.router.navigateByUrl(homePathFor(result.user));
    } catch (failure) {
      this.error.set(errorMessage(failure));
      // Re-read rather than guess: an invitation that lost a race — revoked, or
      // accepted in another tab — should now render as what it has become
      // instead of leaving a form that will fail again.
      this.invitation.reload();
    } finally {
      this.busy.set(false);
    }
  }
}
