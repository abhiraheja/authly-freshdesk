import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
} from '@angular/core';
import type { Tone } from '@trackly/core';
import { Badge } from '../badge/badge';
import { Icon, type IconName } from '../icon/icon';

export interface StatDelta {
  /** Pre-formatted, with its sign and unit: `+12%`, `-3%`, `-8m`. */
  readonly value: string;
  readonly direction: 'up' | 'down';
}

/** Static class pairs — Tailwind v4 cannot see interpolated class names. */
const TINT: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary-ink',
  info: 'bg-info/12 text-info-ink',
  success: 'bg-success/14 text-success-ink',
  warning: 'bg-warning/14 text-warning-ink',
  danger: 'bg-danger/12 text-danger-ink',
  neutral: 'bg-neutral/14 text-neutral-ink',
};

/**
 * KPI tile for an Overview page.
 *
 * The delta badge is coloured by whether the change is **good**, not by its
 * sign. Fewer pending tickets is green even though the number fell — pass
 * `invert` for metrics where down is the improvement (resolution time, backlog).
 *
 * Pass `undefined` for a value that hasn't loaded; it renders `—`. Never render
 * a placeholder `0`: it reads as real data and people act on it.
 */
@Component({
  selector: 'tk-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Icon],
  host: {
    '[class]': 'hostClasses()',
    '[attr.role]': 'clickable() ? "button" : null',
    '[attr.tabindex]': 'clickable() ? 0 : null',
    // A clickable non-button must answer Enter and Space itself. RouterLink and
    // (click) only fire on pointer events here, so without this the tile is
    // focusable but dead to a keyboard.
    '(keydown.enter)': 'activate($event)',
    '(keydown.space)': 'activate($event)',
  },
  template: `
    <div class="flex items-center justify-between">
      <div [class]="'grid size-9 place-items-center rounded-lg ' + tint()">
        <tk-icon [name]="icon()" [size]="18" />
      </div>
      @if (delta(); as d) {
        <tk-badge [tone]="deltaTone()">
          <tk-icon [name]="d.direction === 'up' ? 'arrow-up-right' : 'arrow-down-right'" [size]="12" />
          {{ d.value }}
        </tk-badge>
      }
    </div>
    <p class="mt-3 font-display text-page font-extrabold">{{ display() }}</p>
    <p class="mt-0.5 text-meta text-muted-foreground">{{ label() }}</p>
  `,
})
export class StatCard {
  readonly label = input.required<string>();
  readonly value = input<string | number | null | undefined>(undefined);
  readonly icon = input.required<IconName>();
  readonly tone = input<Tone>('primary');
  readonly delta = input<StatDelta | null>(null);
  /** Set when a falling number is the improvement (avg resolution time, backlog). */
  readonly invert = input(false, { transform: booleanAttribute });
  /** Adds hover lift + keyboard affordances. Wire `(click)` and `(keydown.enter)` yourself. */
  readonly clickable = input(false, { transform: booleanAttribute });

  protected readonly tint = computed(() => TINT[this.tone()]);

  protected readonly display = computed(() => {
    const value = this.value();
    return value === null || value === undefined ? '—' : value;
  });

  protected readonly deltaTone = computed<Tone>(() => {
    const delta = this.delta();
    if (!delta) return 'neutral';
    const improved = (delta.direction === 'up') !== this.invert();
    return improved ? 'success' : 'danger';
  });

  protected readonly hostClasses = computed(() =>
    ['card block p-4', this.clickable() ? 'card-interactive' : ''].filter(Boolean).join(' '),
  );

  private readonly host = inject(ElementRef<HTMLElement>);

  /** Turns Enter/Space into the click that `(click)` or `routerLink` listens for. */
  protected activate(event: Event): void {
    if (!this.clickable()) return;
    event.preventDefault();
    this.host.nativeElement.click();
  }
}
