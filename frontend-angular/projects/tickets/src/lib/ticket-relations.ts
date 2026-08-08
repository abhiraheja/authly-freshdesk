import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  PRIORITY_TONE,
  RELATION_KINDS,
  STATUS_TONE,
  TicketsApi,
  errorMessage,
  toneFor,
  type TicketRelation,
  type TicketSummary,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Icon,
  InputDirective,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  ToastService,
} from '@trackly/ui';

/**
 * Related tickets: what else this one duplicates, blocks or was caused by.
 *
 * **The kind arrives already flipped.** The server stores one row per pair and
 * reads it from whichever end is asking, so "A blocks B" shows on B as "blocked
 * by A" without a second row that could fall out of step. Render `kind` as
 * given; do not re-derive it here.
 *
 * Finding the other ticket is a search, not a picker: a workspace has thousands
 * of tickets and a dropdown of them is unusable by the second week.
 */
@Component({
  selector: 'tk-ticket-relations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Badge,
    Icon,
    InputDirective,
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <!-- ── Associations: the problem this ticket belongs to ──────────────────
         A ticket has at most one, so this is a select rather than a list: the
         question is "which underlying cause is this", and there is one answer. -->
    <section class="mb-6">
      <h3 class="mb-1 text-body font-bold">{{ 'tickets.associations.title' | transloco }}</h3>
      <p class="mb-2 text-meta text-muted-foreground">{{ 'tickets.associations.hint' | transloco }}</p>

      <div class="flex flex-wrap items-center gap-2">
        <tk-select
          inset
          size="sm"
          class="min-w-0 flex-1"
          [ariaLabel]="'tickets.associations.title' | transloco"
          [disabled]="busy()"
          [value]="problemId()"
          (valueChange)="setProblem($event)"
        >
          <tk-option value="" [label]="'tickets.associations.none' | transloco" />
          @for (problem of problemList(); track problem.id) {
            <tk-option [value]="problem.id" [label]="problem.title" />
          }
        </tk-select>

        @if (problemId()) {
          <a
            class="inline-flex items-center gap-1.5 text-body font-semibold text-primary hover:underline"
            [routerLink]="['/dashboard/problems', problemId()]"
          >
            <tk-icon name="puzzle" [size]="14" />
            {{ 'tickets.associations.open' | transloco }}
          </a>
        }
      </div>
    </section>

    <h3 class="mb-2 text-body font-bold">{{ 'tickets.relations.title' | transloco }}</h3>

    <!-- Adding sits above the list: on a ticket with ten links, a form at the
         bottom is a scroll away from the button that reveals it. -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <tk-select
        inset
        size="sm"
        class="w-44"
        [ariaLabel]="'tickets.relations.kindLabel' | transloco"
        [(value)]="kind"
      >
        @for (option of kinds; track option) {
          <tk-option [value]="option" [label]="kindLabel(option)" />
        }
      </tk-select>

      <input
        tkInput
        inset
        inputSize="sm"
        class="min-w-0 flex-1"
        [attr.placeholder]="'tickets.relations.searchPlaceholder' | transloco"
        [attr.aria-label]="'tickets.relations.searchLabel' | transloco"
        [ngModel]="query()"
        (ngModelChange)="query.set($event)"
      />

      @if (searching()) {
        <tk-spinner [size]="16" />
      }
    </div>

    <!-- Results only while something is typed: an idle list of "recent tickets"
         is a list nobody asked for taking up the space the links need. -->
    @if (query().trim().length > 1 && matches().length) {
      <ul class="mb-4 divide-y divide-border rounded-lg border border-border">
        @for (match of matches(); track match.id) {
          <li>
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
              [disabled]="busy()"
              (click)="link(match)"
            >
              <span class="font-mono text-meta text-muted-foreground">#{{ match.id.slice(0, 8) }}</span>
              <span class="min-w-0 flex-1 truncate text-body">{{ match.subject }}</span>
              <tk-badge [tone]="statusTone(match.statusCategory).tone" dot>{{ match.statusName }}</tk-badge>
            </button>
          </li>
        }
      </ul>
    }

    @if (relations.value(); as list) {
      @if (list.length) {
        <ul class="divide-y divide-border">
          @for (relation of list; track relation.id) {
            <li class="flex items-center gap-3 py-2.5">
              <span class="w-28 shrink-0 text-meta font-semibold text-muted-foreground">
                {{ kindLabel(relation.kind) }}
              </span>

              <a
                class="min-w-0 flex-1"
                [routerLink]="['/dashboard/tickets', relation.ticketId]"
              >
                <span class="block truncate text-body font-semibold hover:text-primary">
                  {{ relation.subject }}
                </span>
                <span class="block font-mono text-meta text-muted-foreground">
                  #{{ relation.ticketId.slice(0, 8) }}
                </span>
              </a>

              <tk-badge [tone]="statusTone(relation.statusCategory).tone" dot>{{ relation.status }}</tk-badge>
              <tk-badge [tone]="priorityTone(relation.priority).tone">
                {{ priorityTone(relation.priority).labelKey | transloco }}
              </tk-badge>

              <button
                type="button"
                class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                [disabled]="busy()"
                [attr.aria-label]="'tickets.relations.remove' | transloco"
                (click)="unlink(relation)"
              >
                <tk-icon name="x" [size]="15" />
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="py-6 text-center text-body text-muted-foreground">
          {{ 'tickets.relations.empty' | transloco }}
        </p>
      }
    } @else if (relations.error()) {
      <tk-alert tone="danger" [heading]="'tickets.relations.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="relations.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <span tkSkeleton class="block h-24 w-full"></span>
    }
  `,
})
export class TicketRelations {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  readonly ticketId = input.required<string>();

  /** The problem this ticket currently belongs to, from the parent's copy. */
  readonly linkedProblemId = input<string | null>(null);

  /** Fired after the association changes, so the parent can reload the ticket. */
  readonly problemChanged = output<void>();

  protected readonly kinds = RELATION_KINDS;
  protected readonly kind = signal<string>('relates');
  protected readonly query = signal('');
  protected readonly busy = signal(false);

  /**
   * The select's own value.
   *
   * A local signal seeded from the input rather than binding the input directly:
   * the write is asynchronous, and a select that snapped back to the old value
   * for the length of a round trip would look like the click did not land.
   */
  protected readonly problemId = signal('');

  private readonly problems = resource({ loader: () => this.api.problems() });
  protected readonly problemList = computed(() => this.problems.value() ?? []);

  constructor() {
    effect(() => {
      const linked = this.linkedProblemId() ?? '';
      untracked(() => this.problemId.set(linked));
    });
  }

  /**
   * Links or unlinks in one action.
   *
   * Unlink is keyed by the TICKET, not the problem — a ticket belongs to at most
   * one, so "which problem am I leaving" is never a question the caller has to
   * answer.
   */
  protected async setProblem(id: string): Promise<void> {
    const previous = this.problemId();
    if (id === previous) return;
    this.problemId.set(id);
    this.busy.set(true);
    try {
      if (id) await this.api.linkProblem(id, this.ticketId());
      else await this.api.unlinkProblem(this.ticketId());
      this.problemChanged.emit();
    } catch (error) {
      // Put the select back: leaving it on a value the server refused is a
      // screen that disagrees with the database.
      this.problemId.set(previous);
      this.toast.error(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly relations = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.ticketRelations(params.id),
  });

  /**
   * Search results.
   *
   * Two characters minimum: one letter matches most of the queue, and the round
   * trip to find that out is wasted on every keystroke of a real search.
   */
  private readonly search = resource({
    params: () => ({ id: this.ticketId(), q: this.query().trim() }),
    loader: ({ params }) =>
      params.q.length > 1
        ? this.api.list({ search: params.q, pageSize: 8 })
        : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 8 }),
  });

  protected readonly searching = computed(() => this.search.isLoading());
  protected readonly loadError = computed(() => errorMessage(this.relations.error()));

  /** The ticket you are on, and anything already linked, are not results. */
  protected readonly matches = computed(() => {
    const linked = new Set((this.relations.value() ?? []).map((r) => r.ticketId));
    return (this.search.value()?.items ?? []).filter(
      (t) => t.id !== this.ticketId() && !linked.has(t.id),
    );
  });

  protected statusTone(category: string) {
    return toneFor(STATUS_TONE, category);
  }

  protected priorityTone(priority: string) {
    return toneFor(PRIORITY_TONE, priority);
  }

  protected kindLabel(kind: string): string {
    const key = `tickets.relations.kinds.${kind}`;
    const text = this.transloco.translate(key);
    return text === key ? kind.replace(/_/g, ' ') : text;
  }

  protected async link(match: TicketSummary): Promise<void> {
    await this.write(() =>
      this.api.addTicketRelation(this.ticketId(), {
        relatedTicketId: match.id,
        kind: this.kind(),
      }),
    );
    // Cleared on success so the results collapse — leaving them up invites a
    // second click on a row that is now already linked.
    this.query.set('');
  }

  protected async unlink(relation: TicketRelation): Promise<void> {
    await this.write(() => this.api.deleteTicketRelation(this.ticketId(), relation.id));
  }

  private async write(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.relations.reload();
      this.busy.set(false);
    }
  }
}
