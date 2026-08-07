import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  PRIORITY_TONE,
  STATUS_TONE,
  TicketsApi,
  formatDateTime,
  errorMessage,
  valueOr,
  slaState,
  toneFor,
  type TicketDetail,
  type TriageSuggestion,
  type UpdateTicketBody,
} from '@trackly/core';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  InputDirective,
  LabelDirective,
  Combobox,
  Modal,
  Spinner,
  TagInput,
  ToastService,
} from '@trackly/ui';
import { CustomerForm } from './customer-form';

/**
 * The right rail of the ticket view: everything about the ticket that isn't the
 * conversation.
 *
 * Every control writes immediately — there is no Save button. That is the right
 * trade here because each field is a single independent value and an agent
 * changing a priority mid-conversation should not have to remember to commit
 * it. The parent owns the write and the reload; this only emits intent.
 */
@Component({
  selector: 'tk-ticket-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    RouterLink,
    Avatar,
    Badge,
    Button,
    Card,
    Icon,
    InputDirective,
    Combobox,
    CustomerForm,
    LabelDirective,
    Modal,
    Spinner,
    TagInput,
  ],
  template: `
    <div class="space-y-4">
      <!-- 1. Ticket information: the read-only answer to "what is this".
           It leads because it is what an agent opening a ticket scans first;
           the editable Properties card is a follow-up action, not a summary. -->
      <tk-card [heading]="'tickets.detail.ticketInfo' | transloco">
        <dl class="space-y-2.5 text-body">
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'tickets.columns.status' | transloco }}</dt>
            <dd><tk-badge [tone]="statusTone().tone" dot>{{ statusTone().labelKey | transloco }}</tk-badge></dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'tickets.columns.priority' | transloco }}</dt>
            <dd><tk-badge [tone]="priorityTone().tone">{{ priorityTone().labelKey | transloco }}</tk-badge></dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'tickets.new.department' | transloco }}</dt>
            <dd class="font-semibold">{{ ticket().teamName || ('tickets.new.noDepartment' | transloco) }}</dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'tickets.columns.assignee' | transloco }}</dt>
            <dd class="flex min-w-0 items-center gap-1.5 font-semibold">
              @if (ticket().assignee; as agent) {
                <tk-avatar [name]="agent.name || agent.email" [size]="20" />
                <span class="truncate">{{ agent.name || agent.email }}</span>
              } @else {
                <span class="text-muted-foreground">{{ 'tickets.unassigned' | transloco }}</span>
              }
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'tickets.new.category' | transloco }}</dt>
            <dd class="font-semibold">{{ ticket().category?.name || ('tickets.new.noCategory' | transloco) }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'tickets.detail.channel' | transloco }}</dt>
            <dd class="font-semibold">{{ ticket().channel }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
            <dt class="text-muted-foreground">{{ 'tickets.detail.id' | transloco }}</dt>
            <dd class="font-mono text-meta">#{{ ticket().id.slice(0, 8) }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'tickets.detail.created' | transloco }}</dt>
            <dd class="text-meta">{{ created() }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'tickets.columns.updated' | transloco }}</dt>
            <dd class="text-meta">{{ updated() }}</dd>
          </div>
        </dl>
      </tk-card>

      <!-- 2. SLA. Always rendered, never hidden when there is no clock: an
           absent card reads as "not built yet", and the useful information is
           precisely that no policy covers this ticket. -->
      <tk-card>
        <div class="flex items-baseline justify-between gap-2">
          <h3 class="card-title font-display">{{ 'tickets.detail.slaTimer' | transloco }}</h3>
          @if (sla(); as state) {
            <span class="text-meta font-bold" [class]="slaTextClass()">{{ slaLabel() }}</span>
          }
        </div>

        @if (sla(); as state) {
          <div class="mt-2 flex items-baseline gap-2">
            <!-- tabular-nums so the digits do not jitter as the clock ticks. -->
            <span class="font-display text-display font-extrabold tabular-nums" [class]="slaTextClass()">
              {{ countdown() }}
            </span>
            <span class="text-body text-muted-foreground">
              {{ (overdue() ? 'tickets.detail.overBy' : 'tickets.detail.remaining') | transloco }}
            </span>
          </div>
          <p class="mt-1 text-meta text-muted-foreground">{{ state.prefixKey | transloco }}</p>
          <div class="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full transition-[width]" [class]="slaBarClass()" [style.width.%]="slaPercent()"></div>
          </div>
        } @else {
          <p class="mt-2 text-body text-muted-foreground">{{ 'tickets.detail.noSla' | transloco }}</p>
          <a tkButton variant="outline" size="sm" class="mt-3 w-full" routerLink="/admin/settings/sla">
            {{ 'tickets.detail.slaConfigure' | transloco }}
          </a>
        }
      </tk-card>

      <!-- 3. AI insights. Real when the workspace has the copilot on; otherwise
           the card states plainly that it is off rather than showing invented
           numbers an agent might act on. -->
      <tk-card [heading]="'tickets.detail.aiInsights' | transloco">
        @if (aiOn()) {
          @if (triage(); as t) {
            <dl class="space-y-2.5 text-body">
              <div class="flex items-baseline justify-between gap-3">
                <dt class="text-muted-foreground">{{ 'tickets.detail.sentiment' | transloco }}</dt>
                <dd class="font-semibold">{{ t.sentiment }}</dd>
              </div>
              <div class="flex items-baseline justify-between gap-3">
                <dt class="text-muted-foreground">{{ 'tickets.detail.priorityRec' | transloco }}</dt>
                <dd><tk-badge [tone]="recTone().tone">{{ recTone().labelKey | transloco }}</tk-badge></dd>
              </div>
              @if (t.category) {
                <div class="flex items-baseline justify-between gap-3">
                  <dt class="text-muted-foreground">{{ 'tickets.new.category' | transloco }}</dt>
                  <dd class="font-semibold">{{ t.category }}</dd>
                </div>
              }
            </dl>
            @if (t.tags.length) {
              <div class="mt-3 flex flex-wrap gap-1.5">
                @for (tag of t.tags; track tag) {
                  <tk-badge tone="neutral">{{ tag }}</tk-badge>
                }
              </div>
            }
            <p class="mt-3 text-meta text-muted-foreground">{{ t.rationale }}</p>
            <button tkButton size="sm" class="mt-3 w-full" (click)="applyTriage()">
              {{ 'tickets.detail.applySuggestion' | transloco }}
            </button>
          } @else {
            <button tkButton variant="outline" size="sm" class="w-full" [disabled]="analysing()" (click)="analyse()">
              @if (analysing()) {
                <tk-spinner [size]="14" />
              } @else {
                <tk-icon name="sparkles" [size]="15" />
              }
              {{ 'tickets.detail.analyse' | transloco }}
            </button>
          }
        } @else {
          <p class="text-meta text-muted-foreground">{{ 'tickets.detail.aiOff' | transloco }}</p>
          <a tkButton variant="outline" size="sm" class="mt-3 w-full" routerLink="/admin/settings/ai">
            {{ 'tickets.detail.aiConfigure' | transloco }}
          </a>
        }
      </tk-card>

      <!-- 4. Customer. A guest ticket has an email but no person behind it, so
           the card offers to make one — otherwise the ticket stays orphaned and
           the next one from the same address starts from nothing again. -->
      <tk-card [heading]="'tickets.new.requester' | transloco">
        @if (ticket().requester; as person) {
          <div class="flex items-center gap-3">
            <tk-avatar [name]="customerName()" [size]="40" />
            <div class="min-w-0">
              <p class="truncate text-body font-semibold">{{ customerName() }}</p>
              @if (person.email; as email) {
                <a class="block truncate text-meta text-muted-foreground hover:text-primary" [href]="'mailto:' + email">
                  {{ email }}
                </a>
              }
            </div>
          </div>
          <a tkButton variant="outline" size="sm" class="mt-3 w-full" [routerLink]="['/dashboard/customers', person.id]">
            {{ 'customers.viewProfile' | transloco }}
          </a>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button tkButton variant="ghost" size="sm" (click)="openAddCustomer()">
              {{ 'customers.change' | transloco }}
            </button>
            <!-- Unlink, not delete: the customer stays in the workspace with
                 their other tickets. Only this ticket's link is broken. -->
            <button tkButton variant="ghost" size="sm" (click)="change.emit({ clearRequester: true })">
              {{ 'customers.unlink' | transloco }}
            </button>
          </div>
        } @else {
          <div class="flex items-center gap-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <tk-icon name="user-round" [size]="18" />
            </span>
            <div class="min-w-0">
              <p class="truncate text-body font-semibold">{{ customerName() }}</p>
              <p class="truncate text-meta text-muted-foreground">{{ 'tickets.detail.notLinked' | transloco }}</p>
            </div>
          </div>
          <button tkButton variant="outline" size="sm" class="mt-3 w-full" (click)="openAddCustomer()">
            <tk-icon name="user-plus" [size]="15" />
            {{ 'tickets.detail.linkCustomer' | transloco }}
          </button>
        }
      </tk-card>

      <tk-modal [(open)]="addingCustomer" [heading]="'tickets.detail.linkCustomer' | transloco">
        <div class="space-y-4">
          <p class="text-body text-muted-foreground">{{ 'tickets.detail.linkCustomerHelp' | transloco }}</p>

          <!-- One field for both paths. Typing searches the people who already
               exist; if nothing matches, the same text becomes the new
               customer's email. Two separate "find" and "create" modes would
               make the agent choose before they know which one applies. -->
          <div>
            <label tkLabel for="link-customer">{{ 'tickets.detail.customerSearch' | transloco }}</label>
            <tk-combobox
              inset
              inputId="link-customer"
              [(value)]="customerQuery"
              [suggestions]="customerChoices()"
              [placeholder]="'tickets.new.requesterPlaceholder' | transloco"
              [toggleLabel]="'tickets.new.showSuggestions' | transloco"
            />
          </div>

          <!-- Creating is an explicit mode, checked BEFORE any match. Deriving
               it from "no match yet" raced the customer list: the list loads
               async, so the form appeared while it was still empty and vanished
               mid-typing the moment a match arrived. A mode the user turns on
               stays on until they cancel. -->
          @if (creating()) {
            <tk-customer-form
              #form
              [email]="customerQuery()"
              emailLocked
              [suggestedKeys]="suggestedFieldKeys()"
            />
          } @else if (customers.isLoading()) {
            <p class="flex items-center gap-2 text-meta text-muted-foreground">
              <tk-spinner [size]="14" />
              {{ 'common.loading' | transloco }}
            </p>
          } @else if (matchedCustomer(); as person) {
            <p class="flex items-center gap-2 text-body">
              <tk-icon name="check-circle" [size]="16" class="text-success" />
              {{ 'tickets.detail.willLink' | transloco: { name: person.name || person.email } }}
            </p>
          } @else if (looksLikeEmail()) {
            <button tkButton variant="outline" size="sm" class="w-full" (click)="creating.set(true)">
              <tk-icon name="user-plus" [size]="15" />
              {{ 'tickets.detail.createNew' | transloco: { email: customerQuery().trim() } }}
            </button>
          } @else if (customerQuery().trim()) {
            <p class="text-meta text-muted-foreground">{{ 'tickets.detail.needEmail' | transloco }}</p>
          }
        </div>

        <div modal-footer>
          <button tkButton variant="ghost" (click)="addingCustomer.set(false)">{{ 'common.cancel' | transloco }}</button>
          <button tkButton [disabled]="!canLink() || savingCustomer()" (click)="saveCustomer()">
            @if (savingCustomer()) {
              <tk-spinner [size]="16" />
            }
            {{ (creating() ? 'tickets.detail.createAndLink' : 'tickets.detail.link') | transloco }}
          </button>
        </div>
      </tk-modal>

      <!-- 5. Actions -->
      <tk-card [heading]="'tickets.detail.actions' | transloco">
        <div class="grid grid-cols-2 gap-2">
          <button tkButton variant="outline" size="sm" [disabled]="assignedToMe()" (click)="assignToMe.emit()">
            <tk-icon name="user-plus" [size]="15" />
            {{ 'tickets.detail.assignToMe' | transloco }}
          </button>
          <button tkButton variant="outline" size="sm" [disabled]="watchingAlready()" (click)="watchMe.emit()">
            <tk-icon name="eye" [size]="15" />
            {{ 'tickets.detail.watch' | transloco }}
          </button>
          <button tkButton variant="outline" size="sm" (click)="escalate.emit()">
            <tk-icon name="trending-up" [size]="15" />
            {{ 'tickets.detail.escalate' | transloco }}
          </button>
          <button tkButton variant="outline" size="sm" (click)="copyLink()">
            <tk-icon name="external-link" [size]="15" />
            {{ 'tickets.detail.copyLink' | transloco }}
          </button>
        </div>
        <!-- Merge and Delete are absent on purpose: Trackly has no endpoint for
             either, and a button that cannot do its job is worse than none. -->
      </tk-card>

      <!-- 6. Editing lives below the summary: changing a field is a deliberate
           act, and putting the controls first made every read start with a
           row of selects. -->
      <tk-card [heading]="'tickets.detail.properties' | transloco">
        <div class="space-y-4">
          <div>
            <label tkLabel for="detail-assignee">{{ 'tickets.columns.assignee' | transloco }}</label>
            <select
              tkInput
              inset
              inputSize="sm"
              id="detail-assignee"
              [ngModel]="ticket().assignee?.id ?? ''"
              (ngModelChange)="assign($event)"
            >
              <option value="">{{ 'tickets.unassigned' | transloco }}</option>
              @for (agent of agentList(); track agent.id) {
                <option [value]="agent.id">{{ agent.name || agent.email }}</option>
              }
            </select>
          </div>

          <div>
            <label tkLabel for="detail-priority">{{ 'tickets.columns.priority' | transloco }}</label>
            <select
              tkInput
              inset
              inputSize="sm"
              id="detail-priority"
              [ngModel]="ticket().priority"
              (ngModelChange)="change.emit({ priority: $event })"
            >
              @for (option of priorityOptions(); track option.id) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>

          <div>
            <label tkLabel for="detail-team">{{ 'tickets.new.department' | transloco }}</label>
            <select
              tkInput
              inset
              inputSize="sm"
              id="detail-team"
              [ngModel]="ticket().teamId ?? ''"
              (ngModelChange)="setTeam($event)"
            >
              <option value="">{{ 'tickets.new.noDepartment' | transloco }}</option>
              @for (team of teamList(); track team.id) {
                <option [value]="team.id">{{ team.name }}</option>
              }
            </select>
          </div>

          <div>
            <label tkLabel for="detail-category">{{ 'tickets.new.category' | transloco }}</label>
            <select
              tkInput
              inset
              inputSize="sm"
              id="detail-category"
              [ngModel]="ticket().category?.id ?? ''"
              (ngModelChange)="setCategory($event)"
            >
              <option value="">{{ 'tickets.new.noCategory' | transloco }}</option>
              @for (category of categoryList(); track category.id) {
                <option [value]="category.id">{{ category.name }}</option>
              }
            </select>
          </div>

          <div>
            <label tkLabel for="detail-tags">{{ 'tickets.new.tags' | transloco }}</label>
            <tk-tag-input
              inset
              inputId="detail-tags"
              [value]="tagNames()"
              (valueChange)="tagsChange.emit($event)"
              [suggestions]="tagSuggestions()"
              [placeholder]="'tickets.new.tagsPlaceholder' | transloco"
              [removeLabel]="'tickets.new.removeTag' | transloco"
              [createLabel]="'tickets.new.createTag' | transloco"
            />
          </div>
        </div>
      </tk-card>

      <tk-card [heading]="'tickets.detail.watchers' | transloco">
        <div class="space-y-2">
          @for (watcher of ticket().watchers; track watcher.agent.id) {
            <div class="flex items-center gap-2.5">
              <tk-avatar [name]="watcher.agent.name || watcher.agent.email" [size]="28" />
              <span class="min-w-0 flex-1 truncate text-body">{{ watcher.agent.name || watcher.agent.email }}</span>
              <button
                type="button"
                class="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-danger"
                [attr.aria-label]="'tickets.detail.removeWatcher' | transloco"
                (click)="unwatch.emit(watcher.agent.id)"
              >
                <tk-icon name="x" [size]="14" />
              </button>
            </div>
          } @empty {
            <p class="text-meta text-muted-foreground">{{ 'tickets.detail.noWatchers' | transloco }}</p>
          }

          <select
            tkInput
            inset
            inputSize="sm"
            [attr.aria-label]="'tickets.detail.addWatcher' | transloco"
            [ngModel]="''"
            (ngModelChange)="watch.emit($event)"
          >
            <option value="">{{ 'tickets.detail.addWatcher' | transloco }}</option>
            @for (agent of unwatched(); track agent.id) {
              <option [value]="agent.id">{{ agent.name || agent.email }}</option>
            }
          </select>
        </div>
      </tk-card>

    </div>
  `,
})
export class TicketDetailPanel {
  private readonly api = inject(TicketsApi);

  readonly ticket = input.required<TicketDetail>();

  readonly change = output<UpdateTicketBody>();
  readonly tagsChange = output<string[]>();
  readonly watch = output<string>();
  readonly unwatch = output<string>();
  readonly assignToMe = output<void>();
  readonly watchMe = output<void>();
  readonly escalate = output<void>();

  /** The signed-in agent, for the "is this already mine" checks. */
  readonly meId = input<string | null>(null);

  private readonly agents = resource({ loader: () => this.api.agents() });
  private readonly categories = resource({ loader: () => this.api.categories() });
  private readonly teams = resource({ loader: () => this.api.teams() });
  private readonly priorities = resource({ loader: () => this.api.ticketOptions('priority') });
  private readonly tagCatalogue = resource({ loader: () => this.api.tags() });

  protected readonly agentList = computed(() => valueOr(this.agents, []));
  protected readonly categoryList = computed(() => valueOr(this.categories, []));
  protected readonly teamList = computed(() => valueOr(this.teams, []));
  protected readonly priorityOptions = computed(() => valueOr(this.priorities, []));
  protected readonly tagSuggestions = computed(() =>
    [...valueOr(this.tagCatalogue, [])]
      .sort((a, b) => b.ticketCount - a.ticketCount || a.name.localeCompare(b.name))
      .map((tag) => tag.name),
  );

  protected readonly tagNames = computed(() => this.ticket().tags.map((tag) => tag.name));

  /** Watchers already on the ticket are not offerable — picking one is a no-op. */
  protected readonly unwatched = computed(() => {
    const taken = new Set(this.ticket().watchers.map((w) => w.agent.id));
    return this.agentList().filter((agent) => !taken.has(agent.id));
  });

  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  constructor() {
    this.startClock();
  }

  private readonly ai = resource({ loader: () => this.api.aiAvailable() });
  protected readonly aiOn = computed(() => this.ai.value()?.available === true);
  protected readonly triage = signal<TriageSuggestion | null>(null);
  protected readonly analysing = signal(false);
  protected readonly recTone = computed(() => toneFor(PRIORITY_TONE, this.triage()?.priority));

  protected readonly assignedToMe = computed(() => !!this.meId() && this.ticket().assignee?.id === this.meId());
  protected readonly watchingAlready = computed(
    () => !!this.meId() && this.ticket().watchers.some((w) => w.agent.id === this.meId()),
  );

  protected readonly customerName = computed(() => {
    const t = this.ticket();
    return t.requester?.name || t.requester?.email || t.guestName || t.guestEmail || 'Guest';
  });
  protected readonly addingCustomer = signal(false);
  protected readonly customerQuery = signal('');
  /** Explicit "make a new customer" mode — never inferred, see the template. */
  protected readonly creating = signal(false);
  protected readonly savingCustomer = signal(false);
  protected readonly form = viewChild(CustomerForm);

  /** Keys an admin has configured, offered as a datalist on every field row. */
  private readonly fieldKeys = resource({ loader: () => this.api.ticketOptions('customer_field') });
  protected readonly suggestedFieldKeys = computed(() => valueOr(this.fieldKeys, []).map((o) => o.label));

  protected readonly customers = resource({ loader: () => this.api.users('customer') });

  /** "Name (email)" — one searchable string, and the email is what disambiguates. */
  private readonly customerOptions = computed(() =>
    valueOr(this.customers, []).map((user) => ({
      user,
      label: user.name ? `${user.name} (${user.email ?? ''})`.replace(' ()', '') : (user.email ?? user.id),
    })),
  );
  protected readonly customerChoices = computed(() => this.customerOptions().map((o) => o.label));

  /** An exact hit on an existing person — link, don't create. */
  protected readonly matchedCustomer = computed(() => {
    const typed = this.customerQuery().trim().toLowerCase();
    if (!typed) return null;
    return (
      this.customerOptions().find((o) => o.label.toLowerCase() === typed)?.user ??
      this.customerOptions().find((o) => o.user.email?.toLowerCase() === typed)?.user ??
      null
    );
  });

  protected readonly looksLikeEmail = computed(() => {
    const typed = this.customerQuery().trim();
    return typed.includes('@') && !typed.startsWith('@') && !typed.endsWith('@');
  });

  protected readonly canLink = computed(() =>
    this.creating() ? this.looksLikeEmail() : !!this.matchedCustomer(),
  );

  /** Prefilled from the guest details — usually the whole answer already. */
  protected openAddCustomer(): void {
    const t = this.ticket();
    this.customerQuery.set(t.guestEmail ?? '');
    this.creating.set(false);
    this.addingCustomer.set(true);
  }

  /**
   * Two steps, and the order matters: create (or find) the customer, then point
   * the ticket at them. If the second call fails the customer still exists, so
   * a retry is one click rather than a duplicate person.
   */
  protected async saveCustomer(): Promise<void> {
    const matched = this.creating() ? null : this.matchedCustomer();
    if (matched) {
      this.change.emit({ requesterId: matched.id });
      this.addingCustomer.set(false);
      return;
    }

    this.savingCustomer.set(true);
    try {
      const person = await this.api.createCustomer({
        ...(this.form()?.body() ?? {}),
        email: this.customerQuery().trim(),
      });
      this.change.emit({ requesterId: person.id });
      this.customers.reload();
      this.addingCustomer.set(false);
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.savingCustomer.set(false);
    }
  }

  /**
   * How much of the SLA window is gone, 0–100. Overdue pins at 100 rather than
   * running past it — a bar that overflows its track says nothing extra, and
   * the badge beside it already reads "overdue".
   */
  /**
   * Ticks once a second so the countdown is live rather than frozen at page
   * load. Cleared on destroy — an interval that outlives its component keeps
   * the whole component graph alive with it.
   */
  private readonly now = signal(Date.now());

  private startClock(): void {
    const handle = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(handle));
  }

  /** The deadline actually in play: first response until it is met, then resolve. */
  private readonly dueAt = computed(() => {
    const t = this.ticket();
    if (t.firstResponseDueAt && !t.firstResponseAt) return t.firstResponseDueAt;
    if (t.status === 'resolved' || t.status === 'closed') return null;
    return t.resolveDueAt;
  });

  protected readonly overdue = computed(() => {
    const due = this.dueAt();
    return !!due && new Date(due).getTime() < this.now();
  });

  /**
   * HH:MM:SS, and overdue counts UP rather than showing a negative — a minus
   * sign in front of a timer reads as a rendering bug, not as "late".
   */
  protected readonly countdown = computed(() => {
    const due = this.dueAt();
    if (!due) return '--:--:--';
    const seconds = Math.floor(Math.abs(new Date(due).getTime() - this.now()) / 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  });

  protected readonly slaLabel = computed(() =>
    this.transloco.translate(
      this.overdue()
        ? 'tickets.detail.slaBreached'
        : this.sla()?.tone === 'warning'
          ? 'tickets.detail.slaAtRisk'
          : 'tickets.detail.slaOnTrack',
    ),
  );

  protected readonly slaPercent = computed(() => {
    const t = this.ticket();
    const dueAt = t.firstResponseAt ? t.resolveDueAt : (t.firstResponseDueAt ?? t.resolveDueAt);
    if (!dueAt) return 0;
    const total = new Date(dueAt).getTime() - new Date(t.createdAt).getTime();
    if (total <= 0) return 100;
    const gone = Date.now() - new Date(t.createdAt).getTime();
    return Math.min(100, Math.max(0, Math.round((gone / total) * 100)));
  });

  /** Static lookups — an interpolated Tailwind class emits no CSS at all. */
  protected readonly slaTextClass = computed(() => {
    switch (this.sla()?.tone) {
      case 'danger':
        return 'text-danger';
      case 'warning':
        return 'text-warning-ink';
      default:
        return 'text-foreground';
    }
  });

  protected readonly slaBarClass = computed(() => {
    switch (this.sla()?.tone) {
      case 'danger':
        return 'bg-gradient-to-r from-warning to-danger';
      case 'warning':
        return 'bg-gradient-to-r from-warning to-danger/80';
      default:
        return 'bg-gradient-to-r from-success to-success';
    }
  });

  protected async analyse(): Promise<void> {
    this.analysing.set(true);
    try {
      this.triage.set(await this.api.triage(this.ticket().id));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.analysing.set(false);
    }
  }

  /**
   * Applies only priority and tags. Category is deliberately left out: the model
   * returns a category NAME, and matching that to a configured category is a
   * guess — a near-miss would file the ticket under something that doesn't
   * exist. The agent can pick it from the select in one click.
   */
  protected applyTriage(): void {
    const suggestion = this.triage();
    if (!suggestion) return;
    this.change.emit({ priority: suggestion.priority });
    if (suggestion.tags.length) {
      this.tagsChange.emit([...new Set([...this.tagNames(), ...suggestion.tags])]);
    }
    this.triage.set(null);
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.toast.success('Link copied');
    } catch {
      // Clipboard is permission-gated and blocked outright on insecure origins,
      // so this is an expected failure, not an exception to swallow silently.
      this.toast.error('Could not copy the link');
    }
  }

  protected readonly statusTone = computed(() => toneFor(STATUS_TONE, this.ticket().status));
  protected readonly priorityTone = computed(() => toneFor(PRIORITY_TONE, this.ticket().priority));
  protected readonly sla = computed(() => slaState(this.ticket()));
  protected readonly created = computed(() => formatDateTime(this.ticket().createdAt));
  protected readonly updated = computed(() => formatDateTime(this.ticket().updatedAt));

  /**
   * Clearing a field is its own flag on the API, not an empty id — a missing
   * `assigneeId` means "leave it alone", so without `unassign` there would be no
   * way to take an assignee off at all.
   */
  protected assign(id: string): void {
    this.change.emit(id ? { assigneeId: id } : { unassign: true });
  }

  protected setTeam(id: string): void {
    this.change.emit(id ? { teamId: id } : { clearTeam: true });
  }

  protected setCategory(id: string): void {
    this.change.emit(id ? { categoryId: id } : { clearCategory: true });
  }
}
