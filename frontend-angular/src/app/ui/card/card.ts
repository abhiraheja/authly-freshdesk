import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';

/**
 * The one panel in the system. Every boxed surface is a `tk-card` — do not
 * invent a second card style; if a surface needs a different look it is almost
 * always a card with different children.
 *
 * ```html
 * <tk-card heading="Members" subheading="14 people">
 *   <button tkButton variant="ghost" size="sm" card-actions>Invite</button>
 *   …body…
 * </tk-card>
 * ```
 *
 * Set `[flush]` when the body owns its own padding — a table or a divided list —
 * so rows meet the card edge instead of floating inside a 20px gutter.
 */
@Component({
  selector: 'tk-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
  template: `
    @if (heading() || hasHeader()) {
      <div class="card-header">
        <div class="min-w-0">
          @if (heading()) {
            <h3 class="card-title font-display truncate">{{ heading() }}</h3>
          }
          @if (subheading()) {
            <p class="mt-0.5 text-meta text-muted-foreground">{{ subheading() }}</p>
          }
        </div>
        <ng-content select="[card-actions]" />
      </div>
    }
    <div [class]="bodyClasses()">
      <ng-content />
    </div>
    <ng-content select="[card-footer]" />
  `,
})
export class Card {
  readonly heading = input<string>('');
  readonly subheading = input<string>('');
  /** Tighter padding, for rails and dense grids. */
  readonly dense = input(false, { transform: booleanAttribute });
  /** Drops body padding — use when the content is a table or a divided list. */
  readonly flush = input(false, { transform: booleanAttribute });
  /** Lift-on-hover + pointer cursor. Pair with a click handler AND a keyboard path. */
  readonly interactive = input(false, { transform: booleanAttribute });

  /** A header is also rendered when only actions are projected, so it can't collapse. */
  protected readonly hasHeader = computed(() => !!this.subheading());

  protected readonly hostClasses = computed(() =>
    ['card block', this.dense() ? 'card-dense' : '', this.interactive() ? 'card-interactive' : '']
      .filter(Boolean)
      .join(' '),
  );

  protected readonly bodyClasses = computed(() => (this.flush() ? '' : 'card-body'));
}
