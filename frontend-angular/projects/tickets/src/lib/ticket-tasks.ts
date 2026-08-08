import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TicketsApi, errorMessage, formatDate, type TicketTask, type UserSummary } from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Checkbox,
  Icon,
  InputDirective,
  Select,
  SelectOption,
  SkeletonDirective,
  ToastService,
} from '@trackly/ui';

/**
 * The checklist on a ticket, and the agents working it alongside the assignee.
 *
 * One tab because they answer the same question from two sides — what is left,
 * and who is on it — and an agent opening either one is usually about to look at
 * the other.
 *
 * **Nothing here blocks resolving the ticket.** An open task is shown, counted
 * and left to the agent's judgement. A hard block would mean a ticket nobody can
 * close because of a checklist item somebody added and forgot, and the usual
 * escape from that is deleting the task, which loses the record.
 */
@Component({
  selector: 'tk-ticket-tasks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Avatar,
    Badge,
    Button,
    Checkbox,
    Icon,
    InputDirective,
    Select,
    SelectOption,
    SkeletonDirective,
  ],
  template: `
    <!-- ── Tasks ─────────────────────────────────────────────────────────── -->
    <section class="mb-6">
      <h3 class="mb-2 flex items-center gap-2 text-body font-bold">
        {{ 'tickets.tasks.title' | transloco }}
        @if (openCount(); as open) {
          <tk-badge tone="warning">{{ 'tickets.tasks.openCount' | transloco: { count: open } }}</tk-badge>
        }
      </h3>

      @if (tasks.value(); as list) {
        @if (list.length) {
          <ul class="mb-3 divide-y divide-border">
            @for (task of list; track task.id) {
              <li class="flex items-center gap-3 py-2">
                <tk-checkbox
                  class="shrink-0"
                  [checked]="!!task.completedAt"
                  [disabled]="busy()"
                  [ariaLabel]="task.title"
                  (checkedChange)="toggle(task, $event)"
                />

                <div class="min-w-0 flex-1">
                  <p class="truncate text-body" [class.line-through]="!!task.completedAt"
                     [class.text-muted-foreground]="!!task.completedAt">
                    {{ task.title }}
                  </p>
                  @if (task.dueAt || task.assignee) {
                    <p class="flex items-center gap-2 text-meta text-muted-foreground">
                      @if (task.assignee; as who) {
                        <tk-avatar [name]="who.name ?? who.email" [imageUrl]="who.avatarUrl" [size]="16" round />
                        <span class="truncate">{{ who.name ?? who.email }}</span>
                      }
                      @if (task.dueAt) {
                        <span [class.text-danger]="overdue(task)">
                          <tk-icon name="clock" [size]="11" class="mr-0.5 inline align-[-1px]" />
                          {{ due(task) }}
                        </span>
                      }
                    </p>
                  }
                </div>

                <button
                  type="button"
                  class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  [disabled]="busy()"
                  [attr.aria-label]="'common.delete' | transloco"
                  (click)="remove(task)"
                >
                  <tk-icon name="trash-2" [size]="14" />
                </button>
              </li>
            }
          </ul>
        }

        <div class="flex flex-wrap items-center gap-2">
          <input
            tkInput
            inset
            inputSize="sm"
            class="min-w-0 flex-1"
            [attr.placeholder]="'tickets.tasks.addPlaceholder' | transloco"
            [attr.aria-label]="'tickets.tasks.addPlaceholder' | transloco"
            [ngModel]="draft()"
            (ngModelChange)="draft.set($event)"
            (keydown.enter)="add()"
          />
          <tk-select
            inset
            size="sm"
            class="w-40"
            [ariaLabel]="'tickets.tasks.assignLabel' | transloco"
            [(value)]="draftAssignee"
          >
            <tk-option value="" [label]="'tickets.unassigned' | transloco" />
            @for (agent of agents(); track agent.id) {
              <tk-option [value]="agent.id" [label]="agent.name || agent.email || ''" />
            }
          </tk-select>
          <button tkButton variant="outline" size="sm" [disabled]="busy() || !draft().trim()" (click)="add()">
            <tk-icon name="plus" [size]="14" />
            {{ 'tickets.tasks.add' | transloco }}
          </button>
        </div>
      } @else if (tasks.error()) {
        <tk-alert tone="danger">{{ taskError() }}</tk-alert>
      } @else {
        <span tkSkeleton class="block h-20 w-full"></span>
      }
    </section>

    <!-- ── Responders ────────────────────────────────────────────────────── -->
    <section>
      <h3 class="mb-1 text-body font-bold">{{ 'tickets.responders.title' | transloco }}</h3>
      <p class="mb-2 text-meta text-muted-foreground">{{ 'tickets.responders.hint' | transloco }}</p>

      @if (responders.value(); as list) {
        @if (list.length) {
          <ul class="mb-3 divide-y divide-border">
            @for (responder of list; track responder.agent.id) {
              <li class="flex items-center gap-2 py-2">
                <tk-avatar
                  [name]="responder.agent.name ?? responder.agent.email"
                  [imageUrl]="responder.agent.avatarUrl"
                  [size]="26"
                  round
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-body font-semibold">
                    {{ responder.agent.name ?? responder.agent.email }}
                  </p>
                  @if (responder.role) {
                    <p class="truncate text-meta text-muted-foreground">{{ responder.role }}</p>
                  }
                </div>
                <button
                  type="button"
                  class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  [disabled]="busy()"
                  [attr.aria-label]="'tickets.responders.remove' | transloco"
                  (click)="removeResponder(responder.agent.id)"
                >
                  <tk-icon name="x" [size]="15" />
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="mb-3 text-body text-muted-foreground">{{ 'tickets.responders.empty' | transloco }}</p>
        }

        <div class="flex flex-wrap items-center gap-2">
          <tk-select
            inset
            size="sm"
            class="w-44"
            [ariaLabel]="'tickets.responders.add' | transloco"
            [(value)]="draftResponder"
          >
            <tk-option value="" [label]="'tickets.responders.pick' | transloco" />
            @for (agent of addableAgents(); track agent.id) {
              <tk-option [value]="agent.id" [label]="agent.name || agent.email || ''" />
            }
          </tk-select>
          <input
            tkInput
            inset
            inputSize="sm"
            class="min-w-0 flex-1"
            [attr.placeholder]="'tickets.responders.rolePlaceholder' | transloco"
            [attr.aria-label]="'tickets.responders.rolePlaceholder' | transloco"
            [ngModel]="draftRole()"
            (ngModelChange)="draftRole.set($event)"
            (keydown.enter)="addResponder()"
          />
          <button
            tkButton
            variant="outline"
            size="sm"
            [disabled]="busy() || !draftResponder()"
            (click)="addResponder()"
          >
            <tk-icon name="user-plus" [size]="14" />
            {{ 'tickets.responders.add' | transloco }}
          </button>
        </div>
      } @else {
        <span tkSkeleton class="block h-16 w-full"></span>
      }
    </section>
  `,
})
export class TicketTasks {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  readonly ticketId = input.required<string>();
  /** Passed down rather than fetched again — the parent already has the roster. */
  readonly agents = input<readonly UserSummary[]>([]);

  protected readonly busy = signal(false);
  protected readonly draft = signal('');
  protected readonly draftAssignee = signal('');
  protected readonly draftResponder = signal('');
  protected readonly draftRole = signal('');

  protected readonly tasks = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.ticketTasks(params.id),
  });

  protected readonly responders = resource({
    params: () => ({ id: this.ticketId() }),
    loader: ({ params }) => this.api.ticketResponders(params.id),
  });

  protected readonly taskError = computed(() => errorMessage(this.tasks.error()));

  protected readonly openCount = computed(
    () => (this.tasks.value() ?? []).filter((t) => !t.completedAt).length,
  );

  /** Nobody already on the ticket — offering them again is a no-op that reads as a bug. */
  protected readonly addableAgents = computed(() => {
    const on = new Set((this.responders.value() ?? []).map((r) => r.agent.id));
    return this.agents().filter((a) => !on.has(a.id));
  });

  protected due(task: TicketTask): string {
    return task.dueAt ? formatDate(task.dueAt) : '';
  }

  /** Only an OPEN task can be late. A finished one carries no urgency. */
  protected overdue(task: TicketTask): boolean {
    return !task.completedAt && !!task.dueAt && new Date(task.dueAt).getTime() < Date.now();
  }

  protected async add(): Promise<void> {
    const title = this.draft().trim();
    if (!title || this.busy()) return;
    const assigneeId = this.draftAssignee() || null;
    await this.write(
      () => this.api.createTicketTask(this.ticketId(), { title, assigneeId }),
      this.tasks,
    );
    this.draft.set('');
  }

  protected async toggle(task: TicketTask, completed: boolean): Promise<void> {
    await this.write(
      () => this.api.updateTicketTask(this.ticketId(), task.id, { completed }),
      this.tasks,
    );
  }

  protected async remove(task: TicketTask): Promise<void> {
    await this.write(() => this.api.deleteTicketTask(this.ticketId(), task.id), this.tasks);
  }

  protected async addResponder(): Promise<void> {
    const agentId = this.draftResponder();
    if (!agentId || this.busy()) return;
    await this.write(
      () => this.api.addTicketResponder(this.ticketId(), agentId, this.draftRole().trim() || null),
      this.responders,
    );
    this.draftResponder.set('');
    this.draftRole.set('');
  }

  protected async removeResponder(agentId: string): Promise<void> {
    await this.write(
      () => this.api.removeTicketResponder(this.ticketId(), agentId),
      this.responders,
    );
  }

  private async write(
    action: () => Promise<unknown>,
    target: { reload: () => void },
  ): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      target.reload();
      this.busy.set(false);
    }
  }
}
