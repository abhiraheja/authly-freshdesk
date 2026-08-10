import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { PublicApi, SessionStore } from '@trackly/core';
import { Avatar, BrandedFrame, ConfirmHost, Icon, Toaster } from '@trackly/ui';

/**
 * The frame the three portal screens render inside.
 *
 * A routed layout rather than something each page wraps itself in, so the
 * branding is fetched once for the whole visit and the header does not flicker
 * between screens.
 *
 * **This is deliberately not the agent Shell.** A customer gets the workspace's
 * name and colour, no Trackly mark, no command palette, no colour-mode toggle and
 * no navigation rail — see `BrandedFrame` and invariant 6. The only chrome they
 * need is a way back to their tickets, a way to raise a new one, and a way out.
 */
@Component({
  selector: 'tk-portal-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, TranslocoPipe, Avatar, BrandedFrame, ConfirmHost, Icon, Toaster],
  template: `
    <tk-branded-frame
      [brandName]="brandName()"
      [logoUrl]="branding.value()?.logoUrl ?? null"
      [accent]="accent()"
      [footerText]="branding.value()?.footerText ?? ''"
      [hidePoweredBy]="branding.value()?.hidePoweredBy ?? false"
    >
      <div frame-actions class="relative flex items-center gap-1">
        <a
          class="hidden rounded-[10px] px-3 py-1.5 text-body font-semibold transition-colors hover:bg-primary-foreground/15 sm:inline-flex"
          routerLink="/portal/tickets/new"
        >
          {{ 'portal.newTicket' | transloco }}
        </a>

        <button
          type="button"
          class="rounded-full p-0.5 transition-colors hover:bg-primary-foreground/15"
          [attr.aria-expanded]="menuOpen()"
          [attr.aria-label]="'portal.account' | transloco"
          (click)="menuOpen.set(!menuOpen())"
        >
          <tk-avatar [name]="session.displayName()" [imageUrl]="session.user()?.avatarUrl ?? null" [size]="32" round />
        </button>

        @if (menuOpen()) {
          <button
            type="button"
            class="fixed inset-0 z-40 cursor-default"
            [attr.aria-label]="'common.closeMenu' | transloco"
            (click)="menuOpen.set(false)"
          ></button>
          <div class="menu absolute right-0 top-full z-50 mt-2 w-56 animate-float-in text-left">
            <p class="truncate px-3 pb-1 pt-2 text-body font-semibold">{{ session.displayName() }}</p>
            @if (session.user()?.email; as email) {
              <p class="truncate px-3 pb-2 text-meta text-muted-foreground">{{ email }}</p>
            }
            <div class="menu-sep"></div>
            <a class="menu-item sm:hidden" routerLink="/portal/tickets/new" (click)="menuOpen.set(false)">
              <tk-icon name="plus" [size]="16" />
              {{ 'portal.newTicket' | transloco }}
            </a>
            <button type="button" class="menu-item text-danger" (click)="signOut()">
              <tk-icon name="log-out" [size]="16" />
              {{ 'common.signOut' | transloco }}
            </button>
          </div>
        }
      </div>

      <router-outlet />
    </tk-branded-frame>

    <tk-confirm-host />
    <tk-toaster />
  `,
})
export class PortalFrame {
  private readonly publicApi = inject(PublicApi);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);

  protected readonly menuOpen = signal(false);

  /**
   * The workspace's public branding.
   *
   * The *public* endpoint even though the visitor is signed in: it is the one
   * that returns what a customer-facing surface is allowed to render, and using
   * the same source here as on `/submit` is what keeps the two pages looking like
   * one product. It never throws — a miss resolves to null and the page falls
   * back to Trackly's palette rather than failing to render.
   */
  protected readonly branding = resource({
    params: () => ({ slug: this.session.workspace()?.slug ?? '' }),
    loader: ({ params }) => (params.slug ? this.publicApi.branding(params.slug) : Promise.resolve(null)),
  });

  /** The session's workspace name covers the gap while branding is in flight. */
  protected readonly brandName = computed(
    () => this.branding.value()?.workspaceName || this.session.workspace()?.name || '',
  );

  protected readonly accent = computed(() => this.branding.value()?.primaryColor ?? null);

  protected async signOut(): Promise<void> {
    this.menuOpen.set(false);
    await this.session.signOut();
    void this.router.navigate(['/login']);
  }
}
