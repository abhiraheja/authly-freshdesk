import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  PROBLEM_STATUSES,
  PROBLEM_TONE,
  PRIORITY_TONE,
  STATUS_TONE,
  TicketsApi,
  errorMessage,
  formatDateTime,
  isTerminalCategory,
  toneFor,
  type TicketSummary,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmService,
  EmptyState,
  Icon,
  PageHeader,
  Select,
  SelectOption,
  SkeletonDirective,
  TableDirective,
  ToastService,
} from '@trackly/ui';

/**
 * One root cause and every ticket filed under it.
 *
 * The screen exists for two moves an agent makes about a group rather than about
 * a ticket: moving the whole investigation along a stage, and ending it. Both are
 * decisions about all of the tickets at once, which is precisely what cannot be
 * expressed on any one of them.
 */
@Component({
  selector: 'tk-problem-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    Alert,
    Avatar,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    Select,
    SelectOption,
    SkeletonDirective,
    TableDirective,
  ],
  template: `
    <a
      class="mb-4 inline-flex items-center gap-1.5 text-body font-semibold text-muted-foreground hover:text-foreground"
      routerLink="/dashboard/problems"
    >
      <tk-icon name="arrow-left" [size]="16" />
      {{ 'problems.title' | transloco }}
    </a>

    @if (problem.value(); as data) {
      <tk-page-header [title]="data.title" [subtitle]="meta()">
        <span page-actions class="flex flex-wrap items-center gap-2">
          <tk-select
            auto
            size="sm"
            [ariaLabel]="'problems.columns.status' | transloco"
            [value]="status()"
            (valueChange)="pickStatus($event)"
          >
            @for (option of statusOptions(); track option.value) {
              <tk-option [value]="option.value" [label]="option.label" />
            }
          </tk-select>

          @if (!resolved()) {
            <button tkButton variant="outline" [disabled]="busy()" (click)="resolveAll()">
              <tk-icon name="check-circle" [size]="16" />
              {{ 'problems.resolveAll' | transloco }}
            </button>
          }
        </span>
      </tk-page-header>

      <div class="space-y-5">
        @if (data.resolvedAt; as at) {
          <tk-alert tone="success" [heading]="'problems.resolvedHeading' | transloco">
            {{ 'problems.resolvedAt' | transloco: { when: when(at) } }}
          </tk-alert>
        }

        @if (actionError(); as message) {
          <tk-alert tone="danger" [heading]="'problems.actionFailed' | transloco">{{ message }}</tk-alert>
        }

        @if (data.description; as description) {
          <tk-card [heading]="'problems.cause' | transloco">
            <p class="whitespace-pre-wrap text-body">{{ description }}</p>
          </tk-card>
        }

        <tk-card flush [heading]="'problems.linked' | transloco" [subheading]="linkedCount()">
          <div class="overflow-x-auto">
            <table tkTable hover class="min-w-[760px]">
              <thead>
                <tr>
                  <th scope="col">{{ 'tickets.columns.ticket' | transloco }}</th>
                  <th scope="col" class="w-[13rem]">{{ 'tickets.columns.requester' | transloco }}</th>
                  <th scope="col" class="w-[9rem]">{{ 'tickets.columns.priority' | transloco }}</th>
                  <th scope="col" class="w-[10rem]">{{ 'tickets.columns.status' | transloco }}</th>
                  <th scope="col" class="w-[6rem]">
                    <span class="sr-only">{{ 'common.actions' | transloco }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (ticket of data.tickets; track ticket.id) {
                  <tr>
                    <td class="max-w-0">
                      <a
                        class="block truncate font-semibold hover:text-primary"
                        [routerLink]="['/dashboard/tickets', ticket.id]"
                      >
                        {{ ticket.subject }}
                      </a>
                      <span class="font-mono text-meta text-muted-foreground">#{{ number(ticket) }}</span>
                    </td>
                    <td>
                      <span class="flex min-w-0 items-center gap-1.5">
                        <tk-avatar
                          [name]="requester(ticket)"
                          [imageUrl]="ticket.requester?.avatarUrl ?? null"
                          [size]="22"
                          round
                        />
                        <span class="truncate text-body">{{ requester(ticket) }}</span>
                      </span>
                    </td>
                    <td>
                      @let priority = priorityTone(ticket);
                      <tk-badge [tone]="priority.tone">{{ priority.labelKey | transloco }}</tk-badge>
                    </td>
                    <td>
                      @let state = statusTone(ticket);
                      <tk-badge [tone]="state.tone" dot>{{ ticket.statusName || (state.labelKey | transloco) }}</tk-badge>
                    </td>
                    <td>
                      <span class="row-actions flex justify-end">
                        <button
                          tkButton
                          variant="ghost"
                          size="sm"
                          iconOnly
                          [disabled]="busy()"
                          [attr.aria-label]="'problems.unlinkOne' | transloco: { subject: ticket.subject }"
                          (click)="unlink(ticket)"
                        >
                          <tk-icon name="unlink" [size]="16" />
                        </button>
                      </span>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="p-0">
                      <!-- Linking happens on the ticket, not here: an agent finds
                           the duplicate while reading it, and a picker on this
                           page would mean searching for tickets by memory. -->
                      <tk-empty-state
                        icon="ticket"
                        [heading]="'problems.noTickets' | transloco"
                        [description]="'problems.noTicketsBody' | transloco"
                      />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </tk-card>
      </div>
    } @else if (problem.error()) {
      <tk-alert tone="danger" [heading]="'problems.loadOneFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="problem.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <span tkSkeleton class="block h-[380px] w-full rounded-2xl"></span>
    }
  `,
})
export class ProblemDetail {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  readonly id = input.required<string>();

  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly problem = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.problem(params.id),
  });

  protected readonly loadError = computed(() => errorMessage(this.problem.error()));

  /**
   * The select's own value, mirrored from the server.
   *
   * `tk-select` writes its model the moment an option is picked, so a change that
   * fails — or one the agent cancels — has to be pushed back through a signal the
   * template actually binds, or Angular skips the write as a no-op.
   */
  protected readonly status = signal('');
  protected readonly resolved = computed(() => this.status() === 'resolved');

  constructor() {
    // The server is the authority: a failed write reloads, and either way the
    // select follows what the problem actually says.
    effect(() => {
      const value = this.problem.value()?.status;
      if (value) this.status.set(value);
    });
  }

  protected readonly statusOptions = computed(() => {
    this.lang();
    return PROBLEM_STATUSES.map((value) => ({
      value,
      label: this.transloco.translate(`problems.status.${value}`),
    }));
  });

  protected readonly meta = computed(() => {
    this.lang();
    const data = this.problem.value();
    if (!data) return '';
    const owner = data.assignee?.name || data.assignee?.email;
    return owner
      ? this.transloco.translate('problems.metaOwned', { count: data.ticketCount, owner })
      : this.transloco.translate('problems.meta', { count: data.ticketCount });
  });

  protected readonly linkedCount = computed(() => {
    this.lang();
    const count = this.problem.value()?.tickets.length ?? 0;
    return this.transloco.translate(count === 1 ? 'problems.linkedOne' : 'problems.linkedCount', { count });
  });

  protected statusTone(ticket: TicketSummary) {
    return toneFor(STATUS_TONE, ticket.statusCategory);
  }

  protected priorityTone(ticket: TicketSummary) {
    return toneFor(PRIORITY_TONE, ticket.priority);
  }

  protected number(ticket: TicketSummary): string {
    return ticket.id.slice(0, 8);
  }

  protected requester(ticket: TicketSummary): string {
    return (
      ticket.requester?.name ||
      ticket.requester?.email ||
      ticket.guestName ||
      ticket.guestEmail ||
      this.transloco.translate('tickets.guest')
    );
  }

  protected when(iso: string): string {
    return formatDateTime(iso);
  }

  /**
   * Moving the stage is one write; choosing **resolved** from here is a different
   * decision, so it goes through the same confirmation as the button.
   */
  protected async pickStatus(next: string): Promise<void> {
    const current = this.problem.value()?.status ?? '';
    if (!next || next === current) return;

    this.status.set(next);
    if (next === 'resolved') {
      await this.resolveAll();
      return;
    }

    await this.run(async () => {
      await this.api.updateProblem(this.id(), { status: next });
      this.toast.success(this.transloco.translate(`problems.status.${next}`));
    }, current);
  }

  /**
   * Ends the problem and every open ticket under it.
   *
   * Confirmed and counted, because this is the one action here that reaches
   * customers — each of those tickets sends its requester a resolution. The
   * server deliberately bypasses the per-ticket resolve gate for it: a rule that
   * blocked one would leave the problem resolved with a ticket open underneath.
   */
  protected async resolveAll(): Promise<void> {
    const data = this.problem.value();
    if (!data) return;

    const open = data.tickets.filter((ticket) => !isTerminalCategory(ticket.statusCategory)).length;
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('problems.resolveHeading'),
      message: this.transloco.translate(
        open === 1 ? 'problems.resolveMessageOne' : 'problems.resolveMessage',
        { count: open, title: data.title },
      ),
      confirmLabel: this.transloco.translate('problems.resolveConfirm'),
      tone: 'success',
    });
    if (!ok) return this.status.set(data.status);

    await this.run(async () => {
      await this.api.resolveProblem(this.id(), true);
      this.toast.success(this.transloco.translate('problems.resolved', { title: data.title }));
    }, data.status);
  }

  protected async unlink(ticket: TicketSummary): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('problems.unlinkHeading'),
      message: this.transloco.translate('problems.unlinkMessage', { subject: ticket.subject }),
      confirmLabel: this.transloco.translate('problems.unlinkConfirm'),
    });
    if (!ok) return;

    await this.run(async () => {
      await this.api.unlinkProblem(ticket.id);
      this.toast.success(this.transloco.translate('problems.unlinked', { subject: ticket.subject }));
    });
  }

  /**
   * One write, one reload, one place errors surface.
   *
   * `revertStatus` puts the select back when the server refused — leaving it on
   * the value that failed is how somebody reads a stage the problem never reached.
   */
  private async run(action: () => Promise<void>, revertStatus?: string): Promise<void> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await action();
      this.problem.reload();
    } catch (error) {
      this.actionError.set(errorMessage(error));
      if (revertStatus) this.status.set(revertStatus);
    } finally {
      this.busy.set(false);
    }
  }
}
