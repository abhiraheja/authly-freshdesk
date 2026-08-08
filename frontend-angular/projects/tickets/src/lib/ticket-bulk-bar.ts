import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type { UserSummary } from '@trackly/core';
import { Dropdown, Icon, Spinner } from '@trackly/ui';

/** What the bar is asking the list to do. One action, already decided. */
export type BulkCommand =
  | { readonly kind: 'assign'; readonly assigneeId: string | null }
  | { readonly kind: 'priority'; readonly priority: string }
  | { readonly kind: 'resolve' }
  | { readonly kind: 'pin'; readonly on: boolean }
  | { readonly kind: 'flag'; readonly on: boolean }
  | { readonly kind: 'delete' };

/** Priorities, as literals. Never interpolated into a class name. */
const PRIORITIES = [
  { value: 'urgent', labelKey: 'priority.urgent' },
  { value: 'high', labelKey: 'priority.high' },
  { value: 'medium', labelKey: 'priority.medium' },
  { value: 'low', labelKey: 'priority.low' },
] as const;

/**
 * The bar that appears above the ticket table once rows are ticked.
 *
 * **It sits in the flow rather than floating over the table.** A floating bar
 * looks better in a screenshot and is worse to use: it covers the rows you are
 * still deciding about, and on a short list it can cover the whole result. Here
 * it pushes the table down by its own height, which is honest about the space
 * it takes and never hides a row.
 *
 * Every destructive or wide-reaching item is one level in — behind the overflow
 * menu — and the two an agent runs all day (assign, resolve) are on the surface.
 * Delete is admin-only and separated by a rule, because it is the one action
 * here that nothing can undo.
 */
@Component({
  selector: 'tk-ticket-bulk-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [TranslocoPipe, Dropdown, Icon, Spinner],
  template: `
    <div class="bulk-bar" role="region" [attr.aria-label]="'tickets.bulk.region' | transloco">
      <span class="bulk-count">{{ countLabel() }}</span>
      <div class="bulk-divider" aria-hidden="true"></div>

      @if (busy()) {
        <span class="flex items-center gap-2 text-muted-foreground">
          <tk-spinner [size]="16" />
          {{ 'tickets.bulk.working' | transloco }}
        </span>
      } @else {
        <!-- Assign. A menu rather than a select: the list of agents is short,
             and "Unassign" is not a value in the same set as a person. -->
        <tk-dropdown>
          <button type="button" class="bulk-action" dropdown-trigger>
            <tk-icon name="user-plus" [size]="16" />
            {{ 'tickets.bulk.assign' | transloco }}
          </button>
          <div dropdown-menu class="max-h-72 w-56 overflow-y-auto">
            @for (agent of agents(); track agent.id) {
              <button type="button" class="menu-item" (click)="run({ kind: 'assign', assigneeId: agent.id })">
                {{ agent.name || agent.email }}
              </button>
            } @empty {
              <p class="px-3 py-2 text-meta text-muted-foreground">
                {{ 'tickets.bulk.noAgents' | transloco }}
              </p>
            }
            <div class="menu-sep"></div>
            <button type="button" class="menu-item" (click)="run({ kind: 'assign', assigneeId: null })">
              {{ 'tickets.bulk.unassign' | transloco }}
            </button>
          </div>
        </tk-dropdown>

        <button type="button" class="bulk-action" (click)="run({ kind: 'resolve' })">
          <tk-icon name="check-circle" [size]="16" />
          {{ 'tickets.bulk.resolve' | transloco }}
        </button>

        <!-- On the surface, in red, and before More. Admin only — the server
             checks the role again, so hiding it here is the courtesy, not the
             control. It sits with the other named actions rather than after the
             overflow menu: an action people must read before pressing does not
             belong past the point where the list stops being a list. -->
        @if (canDelete()) {
          <button type="button" class="bulk-action is-danger" (click)="run({ kind: 'delete' })">
            <tk-icon name="trash-2" [size]="16" />
            {{ 'tickets.bulk.delete' | transloco }}
          </button>
        }

        <!-- Priority, pin and flag. Useful, but not what the bar is for, so they
             are one level in rather than five more words across the top. Last,
             because "More" only means anything after everything it is more
             than. -->
        <tk-dropdown>
          <button type="button" class="bulk-action" dropdown-trigger>
            <tk-icon name="more-horizontal" [size]="16" />
            {{ 'tickets.bulk.more' | transloco }}
          </button>
          <div dropdown-menu class="w-52">
            <p class="menu-label">{{ 'tickets.columns.priority' | transloco }}</p>
            @for (option of priorities; track option.value) {
              <button type="button" class="menu-item" (click)="run({ kind: 'priority', priority: option.value })">
                {{ option.labelKey | transloco }}
              </button>
            }
            <div class="menu-sep"></div>
            <button type="button" class="menu-item" (click)="run({ kind: 'pin', on: true })">
              <tk-icon name="pin" [size]="15" />
              {{ 'tickets.bulk.pin' | transloco }}
            </button>
            <button type="button" class="menu-item" (click)="run({ kind: 'pin', on: false })">
              <tk-icon name="pin" [size]="15" />
              {{ 'tickets.bulk.unpin' | transloco }}
            </button>
            <button type="button" class="menu-item" (click)="run({ kind: 'flag', on: true })">
              <tk-icon name="flag" [size]="15" />
              {{ 'tickets.bulk.flag' | transloco }}
            </button>
            <button type="button" class="menu-item" (click)="run({ kind: 'flag', on: false })">
              <tk-icon name="flag" [size]="15" />
              {{ 'tickets.bulk.unflag' | transloco }}
            </button>
          </div>
        </tk-dropdown>
      }

      <button
        type="button"
        class="bulk-action ml-auto text-muted-foreground"
        [disabled]="busy()"
        (click)="cleared.emit()"
      >
        {{ 'tickets.bulk.clear' | transloco }}
      </button>
    </div>
  `,
})
export class TicketBulkBar {
  private readonly transloco = inject(TranslocoService);

  readonly count = input.required<number>();
  readonly agents = input<readonly UserSummary[]>([]);
  /** Locks every action while one is in flight — two batches at once is nobody's intent. */
  readonly busy = input(false);
  readonly canDelete = input(false);

  readonly commanded = output<BulkCommand>();
  readonly cleared = output<void>();

  protected readonly priorities = PRIORITIES;

  /**
   * One whole-sentence key with a count parameter. English pluralises with an
   * "s" and Hindi does not, so "n" + " selected" cannot be translated.
   */
  protected readonly countLabel = computed(() =>
    this.transloco.translate(
      this.count() === 1 ? 'tickets.bulk.countOne' : 'tickets.bulk.count',
      { count: this.count() },
    ),
  );

  protected run(command: BulkCommand): void {
    if (this.busy()) return;
    this.commanded.emit(command);
  }
}
