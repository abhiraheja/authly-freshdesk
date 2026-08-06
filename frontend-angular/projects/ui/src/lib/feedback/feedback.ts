import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, Directive, computed, input } from '@angular/core';
import { Icon, type IconName } from '../icon/icon';
import type { Tone } from '@trackly/core';

/**
 * Shimmering placeholder. Size it with utilities: `<span tkSkeleton class="h-4 w-32"></span>`.
 *
 * A skeleton must occupy the SAME height as the content it stands in for, or the
 * page jumps when data lands. That is the whole reason to prefer it over a
 * spinner for anything with a known shape.
 */
@Directive({
  selector: '[tkSkeleton]',
  host: { class: 'skeleton block' },
})
export class SkeletonDirective {}

/** Indeterminate spinner. Only for whole-page waits with no known shape. */
@Component({
  selector: 'tk-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  host: { class: 'inline-flex', role: 'status' },
  template: `
    <span
      class="animate-spin rounded-full border-[3px] border-muted-foreground/30 border-t-primary"
      [style.width.px]="size()"
      [style.height.px]="size()"
      aria-hidden="true"
    ></span>
    <span class="sr-only">{{ 'common.loading' | transloco }}</span>
  `,
})
export class Spinner {
  readonly size = input(20);
}

/** Keyboard hint: `<tk-kbd>⌘K</tk-kbd>`. */
@Component({
  selector: 'tk-kbd',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'kbd' },
  template: '<ng-content />',
})
export class Kbd {}

/**
 * Inline message tied to a place on the page — a failed save, a config warning.
 *
 * Use this for anything the user must act on where they are. A toast is for
 * *background* confirmations; it disappears, so it must never carry the only
 * copy of an error.
 */
@Component({
  selector: 'tk-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslocoPipe],
  host: { role: 'alert', '[class]': 'classes()' },
  template: `
    <tk-icon [name]="icon()" [size]="18" class="mt-0.5 shrink-0" />
    <div class="min-w-0 flex-1">
      @if (heading()) {
        <p class="font-semibold">{{ heading() }}</p>
      }
      <div class="text-body"><ng-content /></div>
    </div>
  `,
})
export class Alert {
  readonly tone = input<Tone>('info');
  readonly heading = input('');

  protected readonly icon = computed<IconName>(() => {
    switch (this.tone()) {
      case 'danger':
        return 'alert-circle';
      case 'warning':
        return 'alert-triangle';
      case 'success':
        return 'check-circle';
      default:
        return 'info';
    }
  });

  // A design-system class, NOT composed Tailwind utilities — Tailwind v4 only
  // emits classes it finds as literal strings in the source, so a
  // template-built `bg-${tone}/10` would compile to nothing at all.
  protected readonly classes = computed(() => `alert alert-${this.tone()}`);
}

/**
 * The empty view for any data surface.
 *
 * Distinguish the three cases — the copy is the whole point:
 * - nothing exists yet → offer the create action
 * - filters match nothing → offer "Clear filters", NOT the create action
 * - the request failed   → offer "Try again"
 *
 * Showing a create CTA when the real cause is a filter sends people to build a
 * duplicate of something they already have.
 */
@Component({
  selector: 'tk-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslocoPipe],
  host: { class: 'empty-state' },
  template: `
    <div class="empty-icon">
      <tk-icon [name]="icon()" [size]="28" />
    </div>
    <h2 class="text-section font-bold">{{ heading() }}</h2>
    @if (description()) {
      <p class="max-w-sm text-body text-muted-foreground">{{ description() }}</p>
    }
    <div class="mt-2"><ng-content /></div>
  `,
})
export class EmptyState {
  readonly icon = input<IconName>('inbox');
  readonly heading = input.required<string>();
  readonly description = input('');
}
