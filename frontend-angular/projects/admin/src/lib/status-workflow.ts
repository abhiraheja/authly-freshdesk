import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TicketsApi, errorMessage, type StatusTransition, type TicketStatus } from '@trackly/core';
import { Alert, Button, Card, Checkbox, Icon, SkeletonDirective, Spinner, ToastService } from '@trackly/ui';

/** The "from anywhere" row. Not an id — the server stores null for it. */
const ANY = 'any';

const key = (from: string, to: string) => `${from}>${to}`;

/**
 * Admin → Statuses → Workflow: which status changes are allowed.
 *
 * A matrix, because the question an admin actually has is "can it get from here
 * to there?" and a grid answers that by pointing at one cell. A list of rules
 * makes them read every rule to answer the same question.
 *
 * **Rows are where the ticket is; columns are where it may go.** The first row
 * is "any status", which is how a status is made reachable from everywhere
 * without ticking a whole column — and it is what every status starts with, so
 * a workspace that never opens this screen behaves exactly as Trackly did
 * before workflows existed.
 *
 * **An empty workflow means everything is allowed, not nothing.** That is the
 * server's rule (see `TicketStatusService.ReachableAsync`) and it exists so a
 * workspace can never lock every ticket in place. The banner says so, because
 * an admin who clears the grid expecting a lockdown has to find out here rather
 * than from a confused agent.
 *
 * **Saving replaces the whole workflow.** One PUT, one transaction — there is
 * no moment where half the rules are live. Transitions that involve a retired
 * status are carried through untouched: they are not on this grid, and dropping
 * them would quietly empty the workflow of any status brought back later.
 */
@Component({
  selector: 'tk-admin-status-workflow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Alert, Button, Card, Checkbox, Icon, SkeletonDirective, Spinner],
  template: `
    <p class="mb-4 text-body text-muted-foreground">{{ 'admin.workflow.intro' | transloco }}</p>

    @if (workflow.value()) {
      @if (cells().size === 0) {
        <tk-alert tone="warning" class="mb-4">{{ 'admin.workflow.emptyWarning' | transloco }}</tk-alert>
      } @else if (unreachable().length) {
        <tk-alert tone="warning" class="mb-4">
          {{ 'admin.workflow.unreachable' | transloco: { names: unreachableNames() } }}
        </tk-alert>
      }

      <tk-card flush>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-body">
            <thead>
              <tr>
                <th
                  scope="col"
                  class="sticky left-0 z-10 min-w-[11rem] bg-card px-4 py-3 text-left text-meta font-bold text-muted-foreground"
                >
                  {{ 'admin.workflow.from' | transloco }} \\ {{ 'admin.workflow.to' | transloco }}
                </th>
                @for (column of statuses(); track column.id) {
                  <th scope="col" class="min-w-[6.5rem] px-2 py-3 text-center align-bottom">
                    <span class="text-meta font-semibold">{{ column.name }}</span>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr class="border-t border-border" [class.bg-muted]="row.id === ANY">
                  <th
                    scope="row"
                    class="sticky left-0 z-10 px-4 py-2.5 text-left font-normal"
                    [class.bg-card]="row.id !== ANY"
                    [class.bg-muted]="row.id === ANY"
                  >
                    @if (row.id === ANY) {
                      <span class="flex items-center gap-1.5 font-semibold">
                        <tk-icon name="workflow" [size]="14" class="text-muted-foreground" />
                        {{ 'admin.workflow.anyStatus' | transloco }}
                      </span>
                      <span class="block text-meta text-muted-foreground">
                        {{ 'admin.workflow.anyStatusHint' | transloco }}
                      </span>
                    } @else {
                      {{ row.name }}
                    }
                  </th>

                  @for (column of statuses(); track column.id) {
                    <td class="px-2 py-2.5 text-center">
                      @if (row.id === column.id) {
                        <!-- Staying put is allowed by the server unconditionally,
                             so a cell here would be a lie either way it was set. -->
                        <span class="text-muted-foreground" [title]="'admin.workflow.sameStatus' | transloco">—</span>
                      } @else {
                        <tk-checkbox
                          class="inline-block"
                          [checked]="checked(row.id, column.id)"
                          [disabled]="implied(row.id, column.id) || busy()"
                          [ariaLabel]="cellLabel(row.name, column.name)"
                          [title]="cellTitle(row.id, column.id)"
                          (checkedChange)="set(row.id, column.id, $event)"
                        />
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div card-footer class="card-footer flex flex-wrap items-center gap-2">
          <button tkButton variant="ghost" size="sm" [disabled]="busy()" (click)="allowAll()">
            {{ 'admin.workflow.openAll' | transloco }}
          </button>
          <button tkButton variant="ghost" size="sm" [disabled]="busy()" (click)="clearAll()">
            {{ 'admin.workflow.clearAll' | transloco }}
          </button>

          <span class="ml-auto flex items-center gap-3">
            @if (busy()) {
              <tk-spinner [size]="14" />
            } @else if (dirty()) {
              <span class="text-meta text-muted-foreground">{{ 'admin.workflow.unsaved' | transloco }}</span>
            }
            <button tkButton size="sm" [disabled]="busy() || !dirty()" (click)="save()">
              {{ 'admin.workflow.save' | transloco }}
            </button>
          </span>
        </div>
      </tk-card>
    } @else if (workflow.error()) {
      <tk-alert tone="danger" [heading]="'admin.workflow.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="workflow.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <span tkSkeleton class="h-80 w-full"></span>
    }
  `,
})
export class StatusWorkflow {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** Active statuses, in the order the catalogue shows them. */
  readonly statuses = input.required<readonly TicketStatus[]>();

  protected readonly ANY = ANY;
  protected readonly busy = signal(false);

  protected readonly workflow = resource({ loader: () => this.api.workflow() });

  /** Ticked cells, as `from>to` keys. `from` is a status id or `ANY`. */
  protected readonly cells = signal<ReadonlySet<string>>(new Set());
  /** What the server last gave us, to tell an edit from a reload. */
  private readonly baseline = signal<ReadonlySet<string>>(new Set());

  /**
   * Rules involving a status this grid does not draw — retired ones.
   *
   * Held aside and sent straight back on save. The alternative is a PUT that
   * silently deletes them, so bringing a retired status back would find it
   * unreachable for reasons nobody could see on this screen.
   */
  private preserved: StatusTransition[] = [];

  constructor() {
    effect(() => {
      const transitions = this.workflow.value();
      if (!transitions) return;
      // untracked: this seeds the grid from the server, so it must run when the
      // server answers and at no other time. Tracking `statuses` would let a
      // reload in the neighbouring tab throw away edits in progress here.
      const visible = untracked(() => new Set(this.statuses().map((s) => s.id)));

      const loaded = new Set<string>();
      const kept: StatusTransition[] = [];
      for (const t of transitions) {
        const from = t.fromStatusId ?? ANY;
        const drawable = visible.has(t.toStatusId) && (from === ANY || visible.has(from));
        if (drawable) loaded.add(key(from, t.toStatusId));
        else kept.push(t);
      }

      this.preserved = kept;
      this.cells.set(loaded);
      this.baseline.set(new Set(loaded));
    });
  }

  protected readonly loadError = computed(() => errorMessage(this.workflow.error()));

  protected readonly rows = computed(() => [
    { id: ANY, name: this.transloco.translate('admin.workflow.anyStatus') },
    ...this.statuses(),
  ]);

  /** Columns reachable from anywhere — the whole point of the first row. */
  private readonly fromAny = computed(() => {
    const cells = this.cells();
    return new Set(this.statuses().filter((s) => cells.has(key(ANY, s.id))).map((s) => s.id));
  });

  protected checked(from: string, to: string): boolean {
    // A cell the "any" row already covers reads as ticked even when its own row
    // is not, because that is what the ticket screen will actually do.
    return this.cells().has(key(from, to)) || (from !== ANY && this.fromAny().has(to));
  }

  /** Ticked by the "any" row rather than by this cell, so it cannot be cleared here. */
  protected implied(from: string, to: string): boolean {
    return from !== ANY && this.fromAny().has(to);
  }

  protected cellLabel(from: string, to: string): string {
    return this.transloco.translate('admin.workflow.cellLabel', { from, to });
  }

  /** Explains a cell that is ticked but cannot be unticked from this row. */
  protected cellTitle(from: string, to: string): string {
    return this.implied(from, to) ? this.transloco.translate('admin.workflow.impliedByAny') : '';
  }

  protected set(from: string, to: string, allowed: boolean): void {
    const next = new Set(this.cells());
    if (allowed) next.add(key(from, to));
    else next.delete(key(from, to));
    this.cells.set(next);
  }

  /**
   * The permissive default: every status reachable from anywhere. One row of
   * ticks rather than the whole grid, which is both the smaller workflow to
   * store and the one that keeps working when a status is added later.
   */
  protected allowAll(): void {
    this.cells.set(new Set(this.statuses().map((s) => key(ANY, s.id))));
  }

  protected clearAll(): void {
    this.cells.set(new Set());
  }

  protected readonly dirty = computed(() => {
    const now = this.cells();
    const was = this.baseline();
    if (now.size !== was.size) return true;
    for (const cell of now) if (!was.has(cell)) return true;
    return false;
  });

  /**
   * Statuses no rule can move a ticket into.
   *
   * Worth calling out rather than silently allowing: the grid makes it easy to
   * build, it looks fine, and the only symptom is an agent finding an option
   * missing from a picker weeks later.
   */
  protected readonly unreachable = computed(() => {
    const cells = this.cells();
    if (cells.size === 0) return [];
    return this.statuses().filter(
      (target) =>
        !cells.has(key(ANY, target.id)) &&
        !this.statuses().some((from) => from.id !== target.id && cells.has(key(from.id, target.id))),
    );
  });

  protected readonly unreachableNames = computed(() =>
    this.unreachable()
      .map((s) => s.name)
      .join(', '),
  );

  protected async save(): Promise<void> {
    this.busy.set(true);
    try {
      const transitions = [
        ...this.preserved.map((t) => ({ fromStatusId: t.fromStatusId, toStatusId: t.toStatusId })),
        ...[...this.cells()].map((cell) => {
          const [from, to] = cell.split('>');
          return { fromStatusId: from === ANY ? null : from, toStatusId: to };
        }),
      ];
      await this.api.saveWorkflow(transitions);
      this.toast.success(this.transloco.translate('admin.workflow.saved'));
      this.workflow.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
