import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  PRIORITY_TONE,
  STATUS_TONE,
  SessionStore,
  TicketsApi,
  errorMessage,
  formatDate,
  fromQuery,
  fromQueryOr,
  toneFor,
  type AgentTask,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Card,
  Checkbox,
  EmptyState,
  Icon,
  PageHeader,
  Select,
  SelectOption,
  SkeletonDirective,
  StatCard,
  TableDirective,
  ToastService,
} from '@trackly/ui';

/**
 * Every task assigned to you, across every ticket.
 *
 * **Why this page exists.** Tasks were only ever visible from inside the ticket
 * that owned them, which made them invisible: an agent adds three steps to a
 * ticket on Monday, moves on, and the only thing that would ever remind them is
 * opening that same ticket again. A checklist you have to remember to go and look
 * at is not a checklist. This is the list they can work down.
 *
 * **Filters live in the URL** (`?assignee=me&done=1`), so a lead can send
 * somebody "here is your queue" as a link, and Back works.
 *
 * Ticking a box here writes through the ticket's own endpoint — there is no
 * second way to complete a task, so the activity entry and the resolve gate see
 * exactly the same thing whichever screen it was ticked from.
 */
@Component({
  selector: 'tk-my-tasks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    Alert,
    Avatar,
    Badge,
    Card,
    Checkbox,
    EmptyState,
    Icon,
    PageHeader,
    Select,
    SelectOption,
    SkeletonDirective,
    StatCard,
    TableDirective,
  ],
  template: `
    <tk-page-header [title]="'tasks.title' | transloco" [subtitle]="subtitle()" />

    <!-- Three numbers, because "how much is left" and "how much is late" are
         different questions and the second one is the one that changes plans. -->
    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <tk-stat-card
        [label]="'tasks.stats.open' | transloco"
        icon="clipboard-list"
        tone="info"
        [value]="openCount()"
      />
      <tk-stat-card
        [label]="'tasks.stats.overdue' | transloco"
        icon="clock"
        tone="danger"
        [value]="overdueCount()"
      />
      <tk-stat-card
        [label]="'tasks.stats.dueToday' | transloco"
        icon="timer"
        tone="warning"
        [value]="dueTodayCount()"
      />
    </div>

    <tk-card dense class="mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <tk-select
          auto
          size="sm"
          [ariaLabel]="'tasks.filters.assignee' | transloco"
          [value]="assignee()"
          (valueChange)="setParam('assignee', $event)"
        >
          <tk-option value="me" [label]="'tasks.filters.mine' | transloco" />
          <tk-option value="all" [label]="'tasks.filters.everyone' | transloco" />
          <tk-option value="none" [label]="'tasks.filters.unassigned' | transloco" />
        </tk-select>

        <tk-select
          auto
          size="sm"
          [ariaLabel]="'tasks.filters.state' | transloco"
          [value]="done()"
          (valueChange)="setParam('done', $event)"
        >
          <tk-option value="" [label]="'tasks.filters.openOnly' | transloco" />
          <tk-option value="1" [label]="'tasks.filters.includeDone' | transloco" />
        </tk-select>

        <p class="ml-auto text-meta text-muted-foreground">{{ 'tasks.filters.hint' | transloco }}</p>
      </div>
    </tk-card>

    @if (tasks.error()) {
      <tk-alert tone="danger" [heading]="'tasks.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="tasks.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <tk-card flush>
        <!-- The wrapper scrolls, not the page. Both halves matter: without the
             min-width the columns crush, without overflow-x here the whole page
             slides sideways on a phone. -->
        <div class="overflow-x-auto">
          <table tkTable hover class="min-w-[860px]">
            <thead>
              <tr>
                <th scope="col" class="w-10"><span class="sr-only">{{ 'tasks.columns.done' | transloco }}</span></th>
                <th scope="col">{{ 'tasks.columns.task' | transloco }}</th>
                <th scope="col">{{ 'tasks.columns.ticket' | transloco }}</th>
                <th scope="col">{{ 'tasks.columns.assignee' | transloco }}</th>
                <th scope="col">{{ 'tasks.columns.due' | transloco }}</th>
              </tr>
            </thead>
            <tbody>
              @if (tasks.isLoading() && !tasks.value()) {
                @for (row of skeletonRows; track row) {
                  <tr>
                    <td colspan="5"><span tkSkeleton class="block h-5 w-full"></span></td>
                  </tr>
                }
              } @else {
                @for (task of rows(); track task.id) {
                  <tr>
                    <td>
                      <tk-checkbox
                        [checked]="!!task.completedAt"
                        [disabled]="busy()"
                        [ariaLabel]="task.title"
                        (checkedChange)="toggle(task, $event)"
                      />
                    </td>
                    <td>
                      <p
                        class="font-semibold"
                        [class.line-through]="!!task.completedAt"
                        [class.text-muted-foreground]="!!task.completedAt"
                      >
                        {{ task.title }}
                      </p>
                    </td>
                    <td>
                      <!-- The ticket, not just its id. A task title on its own is
                           frequently meaningless out of context ("chase the
                           vendor" — about what?), so the subject travels with it. -->
                      <a
                        class="block min-w-0 max-w-[22rem]"
                        [routerLink]="['/dashboard/tickets', task.ticketId]"
                      >
                        <span class="block truncate text-body hover:text-primary">{{ task.ticketSubject }}</span>
                        <span class="mt-0.5 flex items-center gap-1.5">
                          <span class="font-mono text-meta text-muted-foreground">#{{ number(task.ticketId) }}</span>
                          <tk-badge [tone]="statusTone(task.ticketStatusCategory).tone" dot>
                            {{ task.ticketStatusName }}
                          </tk-badge>
                          <tk-badge [tone]="priorityTone(task.ticketPriority).tone">
                            {{ priorityTone(task.ticketPriority).labelKey | transloco }}
                          </tk-badge>
                        </span>
                      </a>
                    </td>
                    <td>
                      @if (task.assignee; as who) {
                        <span class="flex items-center gap-1.5">
                          <tk-avatar [name]="who.name || who.email" [imageUrl]="who.avatarUrl" [size]="22" round />
                          <span class="truncate text-body">{{ who.name || who.email }}</span>
                        </span>
                      } @else {
                        <span class="text-meta text-muted-foreground">
                          {{ 'tickets.unassigned' | transloco }}
                        </span>
                      }
                    </td>
                    <td>
                      @if (task.dueAt) {
                        <span
                          class="inline-flex items-center gap-1 text-meta"
                          [class.text-danger]="overdue(task)"
                          [class.font-semibold]="overdue(task)"
                        >
                          <tk-icon name="clock" [size]="12" />
                          {{ due(task) }}
                        </span>
                      } @else {
                        <span class="text-meta text-muted-foreground">—</span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="p-0">
                      <!-- Two different empties. "Nothing assigned to you" is good
                           news; "nothing matches this filter" means change the
                           filter. Saying the same sentence for both is how a
                           filtered-out list reads as an empty workspace. -->
                      <tk-empty-state
                        icon="clipboard-list"
                        [heading]="(filtered() ? 'tasks.empty.filteredHeading' : 'tasks.empty.heading') | transloco"
                        [description]="(filtered() ? 'tasks.empty.filteredBody' : 'tasks.empty.body') | transloco"
                      />
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </tk-card>
    }
  `,
})
export class MyTasks {
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly session = inject(SessionStore);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  /**
   * URL-bound by `withComponentInputBinding()`. Defaults to the caller's own.
   *
   * `fromQueryOr('me')` rather than a bare default: the router writes `undefined`
   * when the param leaves the URL, which does not throw here but reads as
   * "everybody" — so the page would show your tasks under the all-tasks heading
   * with no filter highlighted.
   */
  readonly assignee = input('me', { transform: fromQueryOr('me') });
  readonly done = input('', { transform: fromQuery });

  protected readonly busy = signal(false);
  protected readonly skeletonRows = [0, 1, 2, 3, 4];

  protected readonly tasks = resource({
    params: () => ({ assignee: this.assignee(), done: this.done() }),
    loader: ({ params }) =>
      this.api.tasks({
        // `all` is the absence of the filter, and the API reads a missing
        // assignee as "everybody" — so it is dropped rather than sent.
        assignee: params.assignee === 'all' ? undefined : params.assignee,
        includeDone: params.done === '1',
      }),
  });

  protected readonly rows = computed(() => this.tasks.value() ?? []);
  protected readonly loadError = computed(() => errorMessage(this.tasks.error()));

  /** Whether the empty list is empty because of a filter or because there is nothing. */
  protected readonly filtered = computed(() => this.assignee() !== 'me' || this.done() === '1');

  private readonly open = computed(() => this.rows().filter((task) => !task.completedAt));
  protected readonly openCount = computed(() => this.open().length);

  protected readonly overdueCount = computed(
    () => this.open().filter((task) => this.overdue(task)).length,
  );

  /**
   * Due before midnight tonight and not yet late.
   *
   * Local midnight, not "within 24 hours": "today" is a calendar word, and a task
   * due at 9am tomorrow is not today's problem however few hours away it is.
   */
  protected readonly dueTodayCount = computed(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const cutoff = end.getTime();
    const now = Date.now();
    return this.open().filter((task) => {
      if (!task.dueAt) return false;
      const at = new Date(task.dueAt).getTime();
      return at >= now && at <= cutoff;
    }).length;
  });

  protected readonly subtitle = computed(() => {
    this.lang();
    const me = this.session.user();
    return this.assignee() === 'me'
      ? this.transloco.translate('tasks.subtitleMine', { name: me?.name || me?.email || '' })
      : this.transloco.translate('tasks.subtitleAll');
  });

  protected number(id: string): string {
    return id.slice(0, 8);
  }

  protected statusTone(category: string) {
    return toneFor(STATUS_TONE, category);
  }

  protected priorityTone(priority: string) {
    return toneFor(PRIORITY_TONE, priority);
  }

  protected due(task: AgentTask): string {
    return task.dueAt ? formatDate(task.dueAt) : '';
  }

  /** Only an OPEN task can be late. A finished one carries no urgency. */
  protected overdue(task: AgentTask): boolean {
    return !task.completedAt && !!task.dueAt && new Date(task.dueAt).getTime() < Date.now();
  }

  /** `replaceUrl` so flipping a filter does not bury the previous page in history. */
  protected setParam(key: string, value: string): void {
    void this.router.navigate([], {
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Ticks or unticks, through the ticket's own task endpoint.
   *
   * Deliberately not a second write path. The per-ticket endpoint is what stamps
   * who completed it and writes the activity entry, so a task ticked here is
   * indistinguishable from one ticked on the ticket — which is the only way the
   * resolve gate can be trusted.
   */
  protected async toggle(task: AgentTask, completed: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.updateTicketTask(task.ticketId, task.id, { completed });
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      // Reloaded either way: on failure the box on screen would otherwise show a
      // state the server never took.
      this.tasks.reload();
      this.busy.set(false);
    }
  }
}
