import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
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
 * Trackly cross-links. The caller is responsible for forcing light mode in that
 * case (invariant 6).
 *
 * The panel is hidden below `lg`. It carries no information the user needs —
 * losing it on a phone costs nothing, whereas a squashed illustration above the
 * form costs the whole fold.
 */
@Component({
  selector: 'tk-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Icon],
  host: { class: 'block min-h-screen bg-background' },
  template: `
    <div class="grid min-h-screen lg:grid-cols-2">
      <!-- ─────────────── Form column ─────────────── -->
      <div class="flex flex-col px-6 py-7 sm:px-10">
        <header class="flex items-center gap-2.5">
          @if (logoUrl(); as url) {
            <img [src]="url" [alt]="brandName()" class="size-8 rounded-lg object-contain" />
          } @else if (accent()) {
            <tk-avatar [name]="brandName()" [size]="32" />
          } @else {
            <span class="brand-gradient grid size-8 place-items-center rounded-lg text-white">
              <tk-icon name="life-buoy" [size]="17" />
            </span>
          }
          <span class="font-display text-[17px] font-extrabold tracking-tight">{{ brandName() }}</span>
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
      <div class="hidden p-3 lg:block">
        <aside
          class="relative flex h-full flex-col justify-between overflow-hidden rounded-2xl p-10 xl:p-14"
          [style.background]="panelBackground()"
          aria-hidden="true"
        >
          <!-- Soft depth. Pure decoration, hence aria-hidden on the panel. -->
          <span class="absolute -right-20 -top-20 size-80 rounded-full bg-white/10"></span>
          <span class="absolute -bottom-28 -left-16 size-96 rounded-full bg-white/[0.07]"></span>

          <div class="relative">
            <p class="max-w-md font-display text-[34px] font-extrabold leading-[1.15] tracking-tight text-white">
              {{ panelTitle() }}
            </p>
            <p class="mt-4 max-w-sm text-[15px] leading-relaxed text-white/70">
              {{ panelBody() }}
            </p>
          </div>

          <!-- An illustrative peek at the product. Deliberately generic: it says
               "this is a support desk" without pretending to be live data. -->
          <div class="relative mt-10 space-y-3">
            @for (row of preview; track row.subject) {
              <div class="rounded-xl border border-white/15 bg-white/10 p-3.5 backdrop-blur-sm">
                <div class="flex items-center gap-3">
                  <span class="size-9 shrink-0 rounded-lg bg-white/20"></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-body font-semibold text-white">{{ row.subject }}</span>
                    <span class="block text-meta text-white/60">{{ row.meta }}</span>
                  </span>
                  <span class="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-white">
                    {{ row.status }}
                  </span>
                </div>
              </div>
            }
          </div>
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
  readonly panelTitle = input('Every conversation, in one place.');
  readonly panelBody = input(
    'Email, chat and web requests land in a single queue — with SLAs, automation and an AI copilot behind them.',
  );

  protected readonly preview = [
    { subject: 'Payment deducted, no confirmation', meta: 'Priya N. · via email', status: 'Open' },
    { subject: "Can't reset my password", meta: 'Marcus R. · via chat', status: 'Pending' },
    { subject: 'Refund status?', meta: 'Elena P. · via web form', status: 'Resolved' },
  ];

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
