import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { Badge } from '../badge/badge';
import { Icon, type IconName } from '../icon/icon';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Count shown as a chip — omit rather than passing 0, which reads as data. */
  readonly count?: number;
}

/**
 * A tab rail. Presentational only: it renders the buttons and owns the roving
 * focus, while the caller renders the panel with a `@switch` on the active id.
 *
 * Keeping the panel outside is what makes this usable with lazy content. If the
 * tabs projected their own panels, every panel's bindings would evaluate on
 * every change detection run whether or not it was the visible one.
 *
 * **Overflow.** More tabs than fit is the normal case on a settings page, so the
 * rail scrolls and grows an arrow at whichever end still has something hidden.
 * The selected tab is always scrolled into view, which matters most for the tab
 * that was already half off-screen when it was clicked.
 *
 * ```html
 * <tk-tabs [tabs]="tabs" [(active)]="tab" panelId="config-panel" />
 * <div id="config-panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
 *   @switch (tab()) { @case ('a') { … } }
 * </div>
 * ```
 */
@Component({
  selector: 'tk-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Icon],
  host: {
    class: 'block',
    '(window:resize)': 'measure()',
  },
  template: `
    <div class="tabs-rail">
      @if (canScrollStart()) {
        <button type="button" class="tabs-arrow tabs-arrow-start" [attr.aria-label]="scrollStartLabel()" (click)="nudge(-1)">
          <tk-icon name="chevron-left" [size]="18" />
        </button>
      }

      <div class="tablist" role="tablist" #list (scroll)="measure()">
        <!-- Only the selected tab is in the tab order; the arrow keys move between
             them. A rail of ten tabs should cost one Tab press to skip, not ten. -->
        @for (tab of tabs(); track tab.id) {
          <button
            type="button"
            class="tab"
            role="tab"
            [id]="'tab-' + tab.id"
            [attr.aria-selected]="tab.id === active()"
            [attr.aria-controls]="panelId()"
            [attr.tabindex]="tab.id === active() ? 0 : -1"
            (click)="active.set(tab.id)"
            (keydown)="onKeydown($event)"
          >
            @if (tab.icon) {
              <tk-icon [name]="tab.icon" [size]="16" />
            }
            {{ tab.label }}
            @if (tab.count !== undefined) {
              <tk-badge tone="neutral">{{ tab.count }}</tk-badge>
            }
          </button>
        }
      </div>

      @if (canScrollEnd()) {
        <button type="button" class="tabs-arrow tabs-arrow-end" [attr.aria-label]="scrollEndLabel()" (click)="nudge(1)">
          <tk-icon name="chevron-right" [size]="18" />
        </button>
      }
    </div>
  `,
})
export class Tabs {
  readonly tabs = input<readonly TabItem[]>([]);
  readonly active = model('');
  /** id of the element this rail controls, for `aria-controls`. */
  readonly panelId = input<string>();
  /** Accessible names for the overflow arrows. */
  readonly scrollStartLabel = input('Scroll tabs left');
  readonly scrollEndLabel = input('Scroll tabs right');

  private readonly list = viewChild.required<ElementRef<HTMLDivElement>>('list');

  protected readonly canScrollStart = signal(false);
  protected readonly canScrollEnd = signal(false);

  constructor() {
    // After render: the rail has to have been laid out before it can be
    // measured, and the tab being scrolled to has to exist. Reading tabs() and
    // active() here is what re-runs it when either changes.
    afterRenderEffect(() => {
      this.tabs();
      const id = this.active();
      const list = this.list().nativeElement;

      if (id) {
        // 'nearest' on BOTH axes. Anything else scrolls the page vertically to
        // centre a tab rail that was already perfectly visible.
        list
          .querySelector(`#tab-${CSS.escape(id)}`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      this.measure();
    });
  }

  /** Recomputes which arrows have anywhere to go. */
  protected measure(): void {
    const el = this.list().nativeElement;
    // 1px of slack: fractional layout widths leave scrollWidth a hair above
    // clientWidth even when there is nothing to scroll, which would pin an
    // arrow on screen permanently.
    this.canScrollStart.set(el.scrollLeft > 1);
    this.canScrollEnd.set(Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth - 1);
  }

  /** Scrolls by most of a screenful, keeping a sliver for context. */
  protected nudge(direction: 1 | -1): void {
    const el = this.list().nativeElement;
    el.scrollBy({ left: direction * el.clientWidth * 0.8 });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;

    const tabs = this.tabs();
    const current = tabs.findIndex((tab) => tab.id === this.active());
    if (current < 0) return;

    event.preventDefault();
    const next = tabs[(current + step + tabs.length) % tabs.length];
    this.active.set(next.id);

    // Focus has to follow selection, or the next arrow press comes from the old
    // button and the rail walks backwards.
    const target = event.target as HTMLElement;
    (target.parentElement?.querySelector(`#tab-${CSS.escape(next.id)}`) as HTMLElement | null)?.focus();
  }
}
