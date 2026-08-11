import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SIGN_IN_IMAGE_ASPECT } from '@trackly/core';
import { Avatar, Icon } from '@trackly/ui';

/**
 * The split shell every auth screen sits in: form on the left, a branded panel
 * on the right.
 *
 * Shared by sign-in, verify, sign-up and invitation-accept so the whole
 * entrance to the product is one design rather than four near-misses.
 *
 * **Two brands, one layout.** With no `accent` this is Trackly's own screen —
 * indigo gradient, dark-mode capable. Pass a workspace's `primaryColor` and it
 * becomes that workspace's sign-in: their colour, their name and logo, no
 * Trackly cross-links.
 *
 * An accent does **not** by itself mean light mode. Sign-in and verify are worn
 * by staff as well as customers, so they take the workspace colour and keep the
 * visitor's own scheme; the surfaces invariant 6 actually enumerates — portal,
 * guest views, knowledge base, widget, chat, CSAT — call `forceLight()` for
 * themselves on entry.
 *
 * The panel is hidden below `lg`. It carries no information the user needs —
 * losing it on a phone costs nothing, whereas a squashed illustration above the
 * form costs the whole fold.
 */
@Component({
  selector: 'tk-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Icon, TranslocoPipe],
  host: { class: 'block min-h-screen bg-background' },
  template: `
    <div [class]="gridClass()">
      <!-- ─────────────── Form column ─────────────── -->
      <div class="flex flex-col px-6 py-7 sm:px-10">
        <!-- 44px, not 32: this is the workspace's own mark on the one screen
             everybody in the organisation sees, and at 32 it read as a favicon
             beside the name rather than as the brand. The fallbacks match it so
             the header does not change height with what is configured. -->
        <header class="flex items-center gap-3">
          @if (logoUrl(); as url) {
            <img [src]="url" [alt]="brandName()" class="size-11 rounded-xl object-contain" />
          } @else if (accent()) {
            <tk-avatar [name]="brandName()" [size]="44" />
          } @else {
            <span class="brand-gradient grid size-11 place-items-center rounded-xl text-white">
              <tk-icon name="life-buoy" [size]="23" />
            </span>
          }
          <span class="font-display text-[19px] font-extrabold tracking-tight">{{ brandName() }}</span>
        </header>

        <main class="flex flex-1 items-center justify-center py-10">
          <div class="w-full max-w-[380px]">
            <ng-content />
          </div>
        </main>

        <footer class="text-center text-meta text-muted-foreground">
          <ng-content select="[auth-footer]" />
        </footer>
      </div>

      <!-- ─────────────── Brand panel ─────────────── -->
      <div [class]="panelWrapClass()">
        <aside
          [class]="panelClass()"
          [style.background]="panelBackground()"
          [style.aspect-ratio]="panelAspectRatio()"
          [style.height]="panelHeight()"
          aria-hidden="true"
        >
          <!-- Depth: two soft highlights, not flat colour. Pure decoration,
               hence aria-hidden on the whole panel. -->
          <span class="absolute -right-24 -top-24 size-[26rem] rounded-full bg-white/[0.12] blur-2xl"></span>
          <span class="absolute -bottom-32 -left-24 size-[28rem] rounded-full bg-black/[0.08] blur-3xl"></span>

          @if (imageUrl(); as url) {
            <!--
              Cover is safe here, and only here, because the panel above was
              sized to SIGN_IN_IMAGE_ASPECT — the same ratio the admin cropped
              to. Matching ratios mean cover and contain agree: the picture fills
              the panel edge to edge with nothing trimmed and no background
              showing beside it. Change one of the two and this silently starts
              cutting people's images again.
            -->
            <img [src]="url" alt="" class="absolute inset-0 size-full object-cover" />
            <div class="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent"></div>
            <div class="relative mt-auto">
              <p class="max-w-md font-display text-[32px] font-extrabold leading-[1.15] tracking-tight text-white">
                {{ panelTitle() }}
              </p>
            </div>
          } @else {
            <div class="relative">
              <p class="max-w-md font-display text-[34px] font-extrabold leading-[1.12] tracking-tight text-white">
                {{ panelTitle() }}
              </p>
              <p class="mt-4 max-w-sm text-[15px] leading-relaxed text-white/75">
                {{ panelBody() }}
              </p>
            </div>

            <!-- An illustrative product mock. Deliberately generic — it says
                 "this is a support desk" without pretending to be live data. -->
            <div class="relative mt-12">
              <div class="-rotate-1 rounded-2xl border border-white/20 bg-white/10 p-2.5 shadow-2xl backdrop-blur-md">
                <!-- window chrome -->
                <div class="flex items-center gap-2 px-2 pb-2.5 pt-1">
                  <span class="size-2.5 rounded-full bg-white/40"></span>
                  <span class="size-2.5 rounded-full bg-white/25"></span>
                  <span class="size-2.5 rounded-full bg-white/25"></span>
                  <span class="ml-2 h-6 flex-1 rounded-lg bg-white/10"></span>
                </div>

                <div class="space-y-1.5">
                  @for (row of preview; track row.subject) {
                    <div class="flex items-center gap-3 rounded-xl bg-white/[0.14] px-3 py-2.5">
                      <span
                        class="grid size-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white"
                        [style.background]="row.tint"
                      >
                        {{ row.initials }}
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-[13px] font-semibold text-white">{{ row.subject }}</span>
                        <span class="block truncate text-[11px] text-white/60">{{ row.meta }}</span>
                      </span>
                      <span
                        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                        [style.background]="row.chip"
                      >
                        {{ row.status }}
                      </span>
                    </div>
                  }
                </div>
              </div>

              <!-- Overlapping card — breaks the rectangle so the mock reads as
                   a scene rather than a screenshot. -->
              <div
                class="absolute -bottom-6 right-4 flex items-center gap-2.5 rounded-xl border border-white/25 bg-white/20 px-3.5 py-2.5 shadow-xl backdrop-blur-md"
              >
                <tk-icon name="sparkles" [size]="16" class="text-white" />
                <span class="text-[12px] font-semibold text-white">{{ 'login.panel.aiDrafted' | transloco }}</span>
              </div>
            </div>

            <div class="relative mt-16 flex flex-wrap gap-x-8 gap-y-3">
              @for (stat of stats; track stat.labelKey) {
                <span>
                  <span class="block font-display text-[22px] font-extrabold text-white">{{ stat.value }}</span>
                  <span class="block text-[12px] text-white/60">{{ stat.labelKey | transloco }}</span>
                </span>
              }
            </div>
          }
        </aside>
      </div>
    </div>
  `,
})
export class AuthLayout {
  readonly brandName = input('Trackly');
  readonly logoUrl = input<string | null>(null);
  /** A workspace's primary colour. Null keeps Trackly's own indigo gradient. */
  readonly accent = input<string | null>(null);
  readonly panelTitle = input('');
  readonly panelBody = input('');

  /**
   * Optional artwork for the panel — a photo, an illustration, an animated GIF.
   * Drop the file in `public/` and pass its path; the built-in product mock is
   * replaced and the headline moves over a scrim at the foot of the image.
   *
   * Left unset on purpose: shipping a stock photo would mean shipping someone
   * else's licence, and a hero image is a brand decision, not a code one.
   */
  readonly imageUrl = input<string | null>(null);

  /** Fixed tints, chosen to sit on the gradient rather than fight it. */
  protected readonly preview = [
    { initials: 'PN', subject: 'Payment deducted, no confirmation', meta: 'Priya N. · via email', status: 'Open', tint: 'rgba(255,255,255,.28)', chip: 'rgba(255,255,255,.24)' },
    { initials: 'MR', subject: "Can't reset my password", meta: 'Marcus R. · via chat', status: 'Pending', tint: 'rgba(255,255,255,.20)', chip: 'rgba(255,255,255,.18)' },
    { initials: 'EP', subject: 'Refund status?', meta: 'Elena P. · via web form', status: 'Resolved', tint: 'rgba(255,255,255,.16)', chip: 'rgba(255,255,255,.14)' },
  ];

  protected readonly stats = [
    { value: '12m', labelKey: 'login.panel.statResponse' },
    { value: '96%', labelKey: 'login.panel.statCsat' },
    { value: '6', labelKey: 'login.panel.statChannels' },
  ];

  /**
   * The panel is sized by the artwork, not by the grid.
   *
   * With no image it is the old half-and-half split, and the built-in product
   * mock is laid out for that. With one, the panel takes its height from the
   * viewport and its width from {@link SIGN_IN_IMAGE_ASPECT}, so it is exactly
   * the shape the admin cropped to — which is the only arrangement where the
   * image neither gets trimmed nor leaves brand colour down its sides. The form
   * column absorbs whatever width is left.
   *
   * Every class here is a literal string. Tailwind v4 only emits classes it can
   * find written out, so a computed one would compile to no CSS at all.
   */
  protected readonly gridClass = computed(() =>
    this.imageUrl()
      ? 'grid min-h-screen lg:grid-cols-[1fr_auto]'
      : 'grid min-h-screen lg:grid-cols-2',
  );

  protected readonly panelWrapClass = computed(() =>
    this.imageUrl() ? 'hidden p-3 lg:flex lg:items-center' : 'hidden p-3 lg:block',
  );

  protected readonly panelClass = computed(() =>
    this.imageUrl()
      ? 'relative flex flex-col justify-center overflow-hidden rounded-2xl px-10 py-12 xl:px-14'
      : 'relative flex h-full flex-col justify-center overflow-hidden rounded-2xl px-10 py-12 xl:px-14',
  );

  protected readonly panelAspectRatio = computed(() =>
    this.imageUrl() ? `${SIGN_IN_IMAGE_ASPECT}` : null,
  );

  /**
   * Full height, unless that would make the panel wider than half the viewport.
   *
   * The second term is the width cap expressed as a height, so the ratio holds
   * either way — capping the *width* would have let `max-width` override the
   * derived width and quietly break the aspect the whole arrangement rests on.
   * `1.5rem` is the wrapper's `p-3` on both edges.
   */
  protected readonly panelHeight = computed(() =>
    this.imageUrl() ? `min(calc(100vh - 1.5rem), ${50 / SIGN_IN_IMAGE_ASPECT}vw)` : null,
  );

  /**
   * `color-mix` derives the lighter stop from whatever colour a workspace
   * configured, so any brand gets a real gradient instead of a flat block —
   * without asking admins to pick two colours.
   */
  protected readonly panelBackground = computed(() => {
    const accent = this.accent();
    return accent
      ? `linear-gradient(135deg, ${accent}, color-mix(in oklab, ${accent} 55%, white))`
      : 'linear-gradient(135deg, rgb(79 70 229), rgb(167 139 250))';
  });
}
