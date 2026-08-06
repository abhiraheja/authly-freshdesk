import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  PRIORITY_TONE,
  STATUS_TONE,
  SessionStore,
  TicketsApi,
  errorMessage,
  slaState,
  timeAgo,
  toneFor,
  type TicketSummary,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  InputDirective,
  Pagination,
  ToastService,
  SkeletonDirective,
  TableDirective,
  type IconName,
} from '@trackly/ui';

const PAGE_SIZE = 20;

/** Absent query params arrive as `undefined`; every filter wants `''`. */
function fromQuery(value: string | undefined): string {
  return value ?? '';
}

/** Channel → icon, so the source is readable at a glance in the list. */
const CHANNEL_ICON: Record<string, IconName> = {
  email: 'mail',
  chat: 'messages-square',
  whatsapp: 'message-circle',
  voice: 'phone',
  phone: 'phone',
  api: 'code',
  widget: 'globe',
  web: 'globe',
  form: 'globe',
  manual: 'pencil',
};

/** A saved view maps to the API filter it can actually express. */
const VIEW_STATUS: Record<string, string | undefined> = {
  open: 'open',
  pending: 'pending',
  resolved: 'resolved',
  closed: 'closed',
};

/**
 * Ticket index — the "Index" page shape: header → filter bar → table →
 * pagination.
 *
 * **All filter state lives in the URL.** `?view=open&q=login&page=2` is bound
 * straight into `input()`s by `withComponentInputBinding()`. Three things fall
 * out of that for free: the view is shareable, browser Back works, and the
 * resource's params double as its cache key. The sidebar's saved views and this
 * page's filter bar are therefore the same state, not two copies of it.
 */
@Component({
  selector: 'tk-ticket-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    RouterLink,
    Alert,
    Avatar,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    InputDirective,
    Pagination,
    SkeletonDirective,
    TableDirective,
  ],
  template: `
    <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h1 class="font-display text-page font-extrabold">{{ headingKey() | transloco }}</h1>
        <p class="mt-1 text-body text-muted-foreground">{{ summary() }}</p>
      </div>
      <a tkButton routerLink="/dashboard/tickets/new" class="shrink-0">
        <tk-icon name="plus" [size]="16" />
        {{ 'tickets.newTicket' | transloco }}
      </a>
    </div>

    <!-- Filter bar. Every control writes to the URL, never to local state. -->
    <tk-card dense class="mb-4">
      <!-- One row: search grows, selects shrink to fit. -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-muted px-3">
          <tk-icon name="search" [size]="16" class="text-muted-foreground" />
          <input
            class="w-full bg-transparent text-body outline-none"
            type="search"
            [placeholder]="'tickets.searchPlaceholder' | transloco"
            [attr.aria-label]="'tickets.searchLabel' | transloco"
            [ngModel]="search()"
            (ngModelChange)="onSearch($event)"
          />
        </div>

        <select
          tkInput
          inputSize="sm"
          class="input-auto"
          [attr.aria-label]="'tickets.columns.status' | transloco"
          [ngModel]="view()"
          (ngModelChange)="setParam('view', $event)"
        >
          <option value="">{{ 'tickets.allStatus' | transloco }}</option>
          <option value="open">{{ 'status.open' | transloco }}</option>
          <option value="pending">{{ 'status.pending' | transloco }}</option>
          <option value="resolved">{{ 'status.resolved' | transloco }}</option>
          <option value="closed">{{ 'status.closed' | transloco }}</option>
          <option value="mine">{{ 'tickets.assignedToMe' | transloco }}</option>
        </select>

        <select
          tkInput
          inputSize="sm"
          class="input-auto"
          [attr.aria-label]="'tickets.columns.priority' | transloco"
          [ngModel]="priority()"
          (ngModelChange)="setParam('priority', $event)"
        >
          <option value="">{{ 'tickets.allPriority' | transloco }}</option>
          <option value="urgent">{{ 'priority.urgent' | transloco }}</option>
          <option value="high">{{ 'priority.high' | transloco }}</option>
          <option value="medium">{{ 'priority.medium' | transloco }}</option>
          <option value="low">{{ 'priority.low' | transloco }}</option>
        </select>

        @if (hasFilters()) {
          <button tkButton variant="ghost" size="sm" (click)="clearFilters()">{{ 'tickets.clear' | transloco }}</button>
        }
      </div>
    </tk-card>

    @if (tickets.error()) {
      <tk-alert tone="danger" [heading]="'tickets.loadFailed' | transloco">
        {{ errorText() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="tickets.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <tk-card flush>
        <div class="overflow-x-auto">
          <table tkTable hover class="min-w-[900px]">
            <thead>
              <tr>
                <th scope="col">{{ 'tickets.columns.ticket' | transloco }}</th>
                <th scope="col">{{ 'tickets.columns.requester' | transloco }}</th>
                <th scope="col" class="hidden lg:table-cell">{{ 'tickets.columns.category' | transloco }}</th>
                <th scope="col">{{ 'tickets.columns.priority' | transloco }}</th>
                <th scope="col">{{ 'tickets.columns.status' | transloco }}</th>
                <th scope="col">{{ 'tickets.columns.assignee' | transloco }}</th>
                <th scope="col" class="hidden lg:table-cell">{{ 'tickets.columns.sla' | transloco }}</th>
                <th scope="col" class="hidden md:table-cell text-right">{{ 'tickets.columns.updated' | transloco }}</th>
                <th scope="col" class="text-right">{{ 'tickets.columns.actions' | transloco }}</th>
              </tr>
            </thead>
            <tbody>
              @if (tickets.isLoading()) {
                <!-- Skeletons match the real row height, so nothing jumps when
                     the data lands. -->
                @for (row of skeletonRows; track row) {
                  <tr class="row-blank">
                    <!-- Spelled out rather than looped: the three responsive
                         columns have to disappear here exactly as they do in the
                         header, or a narrow viewport gets 9 skeleton cells under
                         6 headings and every column shifts left. -->
                    <td><span tkSkeleton class="h-4 w-full max-w-[220px]"></span></td>
                    <td><span tkSkeleton class="h-4 w-full max-w-[140px]"></span></td>
                    <td class="hidden lg:table-cell"><span tkSkeleton class="h-4 w-20"></span></td>
                    <td><span tkSkeleton class="h-5 w-16 rounded-full"></span></td>
                    <td><span tkSkeleton class="h-5 w-20 rounded-full"></span></td>
                    <td><span tkSkeleton class="h-4 w-24"></span></td>
                    <td class="hidden lg:table-cell"><span tkSkeleton class="h-4 w-16"></span></td>
                    <td class="hidden md:table-cell"><span tkSkeleton class="ml-auto block h-4 w-14"></span></td>
                    <td><span tkSkeleton class="ml-auto block h-4 w-12"></span></td>
                  </tr>
                }
              } @else {
                @for (ticket of rows(); track ticket.id) {
                  <tr class="cursor-pointer" (click)="open(ticket)">
                    <td>
                      <span class="flex items-start gap-2.5">
                        <tk-icon
                          [name]="channelIcon(ticket.channel)"
                          [size]="16"
                          class="mt-0.5 text-muted-foreground"
                        />
                        <span class="min-w-0">
                          <a
                            class="block max-w-[260px] truncate font-semibold hover:text-primary"
                            [routerLink]="['/dashboard/tickets', ticket.id]"
                            (click)="$event.stopPropagation()"
                          >
                            {{ ticket.subject }}
                          </a>
                          <span class="block text-meta text-muted-foreground">
                            #{{ ticket.id.slice(0, 8) }} · {{ ticket.channel }}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span class="flex items-center gap-2">
                        <tk-avatar [name]="requesterOf(ticket)" [size]="26" round fallback="G" />
                        <span class="truncate">{{ requesterOf(ticket) }}</span>
                      </span>
                    </td>
                    <td class="hidden text-muted-foreground lg:table-cell">
                      {{ ticket.category?.name ?? '—' }}
                    </td>
                    <td>
                      <tk-badge [tone]="priorityOf(ticket).tone">{{ priorityOf(ticket).labelKey | transloco }}</tk-badge>
                    </td>
                    <td>
                      <tk-badge [tone]="statusOf(ticket).tone" dot>{{ statusOf(ticket).labelKey | transloco }}</tk-badge>
                    </td>
                    <td>
                      @if (ticket.assignee; as agent) {
                        <span class="flex items-center gap-2">
                          <tk-avatar [name]="agent.name ?? agent.email" [size]="24" round />
                          <span class="truncate">{{ agent.name ?? agent.email }}</span>
                        </span>
                      } @else {
                        <span class="text-muted-foreground">{{ 'tickets.unassigned' | transloco }}</span>
                      }
                    </td>
                    <td class="hidden lg:table-cell">
                      @if (sla(ticket); as state) {
                        <tk-badge [tone]="state.tone">{{ state.prefixKey | transloco }} {{ state.labelKey | transloco: { time: state.time } }}</tk-badge>
                      } @else {
                        <span class="text-muted-foreground">—</span>
                      }
                    </td>
                    <td class="hidden text-right text-meta text-muted-foreground md:table-cell">
                      {{ ago(ticket.updatedAt) }}
                    </td>
                    <!-- Actions live in their own cell that swallows the click, so
                         hitting one never also opens the row. -->
                    <td class="text-right" (click)="$event.stopPropagation()">
                      <span class="row-actions inline-flex items-center gap-0.5">
                        <a
                          class="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-primary"
                          [routerLink]="['/dashboard/tickets', ticket.id]"
                          [attr.aria-label]="'tickets.actions.view' | transloco"
                        >
                          <tk-icon name="eye" [size]="16" />
                        </a>
                        <button
                          type="button"
                          class="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-success disabled:opacity-40"
                          [attr.aria-label]="'tickets.actions.resolve' | transloco"
                          [disabled]="ticket.status === 'resolved' || ticket.status === 'closed'"
                          (click)="resolve(ticket)"
                        >
                          <tk-icon name="check-circle" [size]="16" />
                        </button>
                      </span>
                    </td>
                  </tr>
                } @empty {
                  <!-- colspan MUST equal the header count (9). Too low and the
                       leftover columns render as bare white cells beside the
                       empty state — which is exactly what a stale 7 looked
                       like. Responsively-hidden columns still count. -->
                  <tr class="row-blank">
                    <td colspan="9" class="p-0">
                      @if (hasFilters()) {
                        <tk-empty-state
                          icon="filter"
                          [heading]="'tickets.empty.noMatchTitle' | transloco"
                          [description]="'tickets.empty.noMatchBody' | transloco"
                        >
                          <button tkButton variant="secondary" (click)="clearFilters()">
                            {{ 'tickets.empty.clearFilters' | transloco }}
                          </button>
                        </tk-empty-state>
                      } @else {
                        <tk-empty-state
                          icon="ticket"
                          [heading]="'tickets.empty.noneTitle' | transloco"
                          [description]="'tickets.empty.noneBody' | transloco"
                        >
                          <a tkButton routerLink="/dashboard/tickets/new">{{ 'tickets.empty.createFirst' | transloco }}</a>
                        </tk-empty-state>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        @if (total() > pageSize) {
          <tk-pagination
            card-footer
            [page]="pageNumber()"
            (pageChange)="setParam('page', $event === 1 ? '' : $event)"
            [total]="total()"
            [pageSize]="pageSize"
          />
        }
      </tk-card>
    }
  `,
})
export class TicketList {
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly transloco = inject(TranslocoService);
  private readonly toast = inject(ToastService);
  /** Re-resolve TS-side copy when the language changes. */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  /**
   * Bound from the query string by `withComponentInputBinding()`.
   *
   * The transform is load-bearing: when a param is **absent** the router sets
   * the input to `undefined` — it does not leave the declared default in place.
   * Without normalising, `view()` is `undefined` rather than `''`, which breaks
   * the `switch` below (falls to `default`) and leaves every `<select>` blank,
   * because no `<option value="">` matches `undefined`.
   */
  readonly view = input('', { transform: fromQuery });
  readonly priority = input('', { transform: fromQuery });
  readonly q = input('', { transform: fromQuery });
  readonly page = input('', { transform: fromQuery });

  protected readonly pageSize = PAGE_SIZE;
  protected readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);

  /** Local mirror of `q`, so typing doesn't push a history entry per keystroke. */
  protected readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly pageNumber = computed(() => Math.max(1, Number(this.page()) || 1));

  protected readonly tickets = resource({
    params: () => ({
      view: this.view(),
      priority: this.priority(),
      search: this.q(),
      page: this.pageNumber(),
      // A view of "mine" needs the signed-in id, so it belongs in the key.
      me: this.session.user()?.id ?? '',
    }),
    loader: ({ params }) =>
      this.api.list({
        status: VIEW_STATUS[params.view],
        assigneeId: params.view === 'mine' ? params.me : undefined,
        priority: params.priority || undefined,
        search: params.search || undefined,
        page: params.page,
        pageSize: PAGE_SIZE,
      }),
  });

  protected readonly rows = computed(() => this.tickets.value()?.items ?? []);
  protected readonly total = computed(() => this.tickets.value()?.total ?? 0);
  protected readonly errorText = computed(() => errorMessage(this.tickets.error()));

  protected readonly hasFilters = computed(() => !!(this.view() || this.priority() || this.q()));

  protected readonly headingKey = computed(() => {
    switch (this.view()) {
      case 'mine':
        return 'tickets.assignedToMe';
      case '':
        return 'tickets.title';
      default:
        return toneFor(STATUS_TONE, this.view()).labelKey;
    }
  });

  /**
   * Four whole-sentence keys, chosen here — never assembled from fragments.
   * English pluralises with an "s"; Hindi does not, and word order differs, so a
   * template that glues `count + ' tickets'` cannot be translated.
   */
  protected readonly summary = computed(() => {
    this.lang();
    if (this.tickets.isLoading()) return this.transloco.translate('tickets.loading');
    const count = this.total();
    const filtered = this.hasFilters();
    const key =
      count === 1
        ? filtered
          ? 'tickets.countOneFiltered'
          : 'tickets.countOne'
        : filtered
          ? 'tickets.countFiltered'
          : 'tickets.count';
    return this.transloco.translate(key, { count });
  });

  constructor() {
    // Keep the search box in step when the URL changes from elsewhere (a sidebar
    // click, Back, a shared link) without fighting the user as they type.
    effect(() => {
      const fromUrl = this.q();
      if (fromUrl !== this.search()) this.search.set(fromUrl);
    });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    // Debounced, and `replaceUrl` so a search doesn't bury the previous page in
    // history one character at a time.
    this.searchTimer = setTimeout(() => this.setParam('q', value, true), 300);
  }

  protected setParam(key: string, value: string | number, replaceUrl = false): void {
    void this.router.navigate([], {
      queryParams: {
        [key]: value === '' || value === 0 ? null : value,
        // Any filter change resets paging — page 3 of the old filter is
        // meaningless under the new one.
        ...(key === 'page' ? {} : { page: null }),
      },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  protected clearFilters(): void {
    void this.router.navigate([], { queryParams: {} });
  }

  protected open(ticket: TicketSummary): void {
    void this.router.navigate(['/dashboard/tickets', ticket.id]);
  }

  protected channelIcon(channel: string): IconName {
    return CHANNEL_ICON[channel?.toLowerCase()] ?? 'mail';
  }

  /** Optimistic-free: reload the list so the row reflects what the server did. */
  protected async resolve(ticket: TicketSummary): Promise<void> {
    try {
      await this.api.update(ticket.id, { status: 'resolved' });
      this.tickets.reload();
      this.toast.success(this.transloco.translate('tickets.resolved'));
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected requesterOf(ticket: TicketSummary): string {
    return (
      ticket.requester?.name ??
      ticket.requester?.email ??
      ticket.guestName ??
      ticket.guestEmail ??
      this.transloco.translate('tickets.guest')
    );
  }

  protected statusOf = (ticket: TicketSummary) => toneFor(STATUS_TONE, ticket.status);
  protected priorityOf = (ticket: TicketSummary) => toneFor(PRIORITY_TONE, ticket.priority);
  protected sla = slaState;
  protected ago = timeAgo;
}
