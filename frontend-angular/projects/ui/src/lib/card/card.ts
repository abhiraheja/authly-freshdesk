import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  model,
} from '@angular/core';
import { Icon } from '../icon/icon';

let nextId = 0;

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
 *
 * Set `[collapsible]` to turn the heading into a disclosure button. It needs a
 * `heading` to be the thing you click, and it hides the body with CSS rather
 * than removing it: projected content belongs to the parent, so an `@if` here
 * would still build every child and only decline to show them — all of the cost
 * and none of the honesty.
 */
@Component({
  selector: 'tk-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '[class]': 'hostClasses()' },
  template: `
    @if (heading() || hasHeader()) {
      <div class="card-header">
        @if (collapsible() && heading()) {
          <button
            type="button"
            class="card-toggle"
            [class.is-collapsed]="collapsed()"
            [attr.aria-expanded]="!collapsed()"
            [attr.aria-controls]="bodyId"
            (click)="collapsed.set(!collapsed())"
          >
            <tk-icon name="chevron-down" [size]="16" class="card-toggle-chevron" />
            <span class="min-w-0">
              <span class="card-title font-display block truncate">{{ heading() }}</span>
              @if (subheading()) {
                <span class="mt-0.5 block text-meta font-normal text-muted-foreground">
                  {{ subheading() }}
                </span>
              }
            </span>
          </button>
        } @else {
          <div class="min-w-0">
            @if (heading()) {
              <h3 class="card-title font-display truncate">{{ heading() }}</h3>
            }
            @if (subheading()) {
              <p class="mt-0.5 text-meta text-muted-foreground">{{ subheading() }}</p>
            }
          </div>
        }
        <ng-content select="[card-actions]" />
      </div>
    }
    <div [id]="bodyId" [class]="bodyClasses()">
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

  /** Turns the heading into a disclosure button. Needs a `heading`. */
  readonly collapsible = input(false, { transform: booleanAttribute });
  /** Two-way, so the owner can remember it — this component does not persist. */
  readonly collapsed = model(false);

  /** Wired to `aria-controls`, so the button actually names what it opens. */
  protected readonly bodyId = `tk-card-body-${nextId++}`;

  /** A header is also rendered when only actions are projected, so it can't collapse. */
  protected readonly hasHeader = computed(() => !!this.subheading());

  protected readonly hostClasses = computed(() =>
    [
      'card block',
      this.dense() ? 'card-dense' : '',
      this.interactive() ? 'card-interactive' : '',
      this.collapsible() && this.collapsed() ? 'is-collapsed' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  protected readonly bodyClasses = computed(() => (this.flush() ? '' : 'card-body'));
}
