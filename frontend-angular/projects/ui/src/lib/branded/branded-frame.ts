import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BRAND_TOKEN_PROPERTIES, ThemeService, brandTokens, initials } from '@trackly/core';

/**
 * The frame every **workspace-branded** surface sits in: the customer portal,
 * the submit form, the knowledge base, the guest ticket view, live chat, CSAT.
 *
 * These pages belong to the tenant, not to Trackly (invariant 6), so this is the
 * counterpart to `Shell` rather than a variation of it. Two differences carry the
 * whole idea:
 *
 * 1. **The palette is the workspace's.** `accent` is written onto this element as
 *    the design system's own colour tokens, so every `tk-button`, `tk-badge` and
 *    focus ring inside re-skins with no branded variant anywhere. See
 *    `brandTokens` for what gets derived from the one hex an admin configured.
 * 2. **It is always light.** A customer never toggles a tenant's palette into
 *    dark mode, so the frame forces light on entry and restores the visitor's own
 *    preference when it is destroyed — which matters, because an agent who looks
 *    at the portal should get their dark mode back afterwards.
 *
 * Content goes in the default slot; header controls (account menu, a link) go in
 * `[frame-actions]`. There is deliberately no navigation rail: a customer has two
 * destinations, and 280px of chrome to hold them would be the loudest thing on
 * the page.
 */
@Component({
  selector: 'tk-branded-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  host: { class: 'flex min-h-screen flex-col bg-background text-foreground' },
  template: `
    <header class="bg-primary text-primary-foreground">
      <div class="mx-auto flex w-full items-center gap-3 px-4 py-3.5" [style.max-width.px]="maxWidth()">
        @if (logoUrl(); as url) {
          <img [src]="url" [alt]="brandName()" class="size-9 shrink-0 rounded-[10px] bg-white object-contain p-1" />
        } @else {
          <!-- No logo uploaded: the workspace's initial on a white tile, which
               still reads as *theirs* rather than falling back to Trackly's mark. -->
          <span class="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white text-body font-extrabold text-primary">
            {{ monogram() }}
          </span>
        }
        <p class="min-w-0 truncate font-display text-[16.5px] font-extrabold tracking-tight">
          {{ brandName() }}
        </p>
        <div class="ml-auto flex shrink-0 items-center gap-1.5">
          <ng-content select="[frame-actions]" />
        </div>
      </div>
    </header>

    <main class="mx-auto w-full flex-1 px-4 py-6" [style.max-width.px]="maxWidth()">
      <ng-content />
    </main>

    <footer class="mx-auto w-full px-4 pb-8 pt-6 text-center text-meta text-muted-foreground" [style.max-width.px]="maxWidth()">
      @if (footerText()) {
        <p>{{ footerText() }}</p>
      }
      @if (!hidePoweredBy()) {
        <p class="mt-1">{{ 'common.poweredBy' | transloco }}</p>
      }
    </footer>
  `,
})
export class BrandedFrame {
  /** The workspace's name — never "Trackly" on a surface a customer reaches. */
  readonly brandName = input('');
  readonly logoUrl = input<string | null>(null);
  /** The workspace's `primaryColor`. Null keeps Trackly's palette. */
  readonly accent = input<string | null>(null);
  /** Admin-authored content, shown verbatim when set. */
  readonly footerText = input('');
  readonly hidePoweredBy = input(false, { transform: booleanAttribute });
  /** 560 for a single form, 860 for a list or a conversation. */
  readonly maxWidth = input(860);

  private readonly host = inject(ElementRef).nativeElement as HTMLElement;

  protected readonly monogram = computed(() => initials(this.brandName(), '·').slice(0, 1));

  constructor() {
    // Invariant 6. Released on destroy so the visitor's own preference comes
    // back — an agent looking at the portal must not be left in light mode.
    const release = inject(ThemeService).forceLight();
    inject(DestroyRef).onDestroy(release);

    // setProperty rather than a [style] binding: Angular's style binding does not
    // reliably reach CSS custom properties, and a token that silently fails to
    // apply looks exactly like a workspace that never configured a colour.
    effect(() => {
      const tokens = brandTokens(this.accent());
      for (const property of BRAND_TOKEN_PROPERTIES) {
        const value = tokens?.[property];
        if (value) this.host.style.setProperty(property, value);
        else this.host.style.removeProperty(property);
      }
    });
  }
}
