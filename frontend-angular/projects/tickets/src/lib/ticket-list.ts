import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
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
  SkeletonDirective,
  TableDirective,
} from '@trackly/ui';

const PAGE_SIZE = 20;

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
        <h1 class="font-display text-page font-extrabold">{{ heading() }}</h1>
        <p class="mt-1 text-body text-muted-foreground">{{ summary() }}</p>
      </div>
      <a tkButton routerLink="/dashboard/tickets/new" class="shrink-0">
        <tk-icon name="plus" [size]="16" />
        New ticket
      </a>
    </div>

    <!-- Filter bar. Every control writes to the URL, never to local state. -->
    <tk-card dense class="mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-xl bg-muted px-3">
          <tk-icon name="search" [size]="16" class="text-muted-foreground" />
          <input
            class="w-full bg-transparent text-body outline-none"
            type="search"
            placeholder="Search subject or requester…"
            aria-label="Search tickets"
            [ngModel]="search()"
            (ngModelChange)="onSearch($event)"
          />
        </div>

        <select
          tkInput
          inputSize="sm"
          class="w-auto"
          aria-label="Status"
          [ngModel]="view()"
          (ngModelChange)="setParam('view', $event)"
        >
          <option value="">All status</option>
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
          <option value="mine">Assigned to me</option>
        </select>

        <select
          tkInput
          inputSize="sm"
          class="w-auto"
          aria-label="Priority"
          [ngModel]="priority()"
          (ngModelChange)="setParam('priority', $event)"
        >
          <option value="">All priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        @if (hasFilters()) {
          <button tkButton variant="ghost" size="sm" (click)="clearFilters()">Clear</button>
        }
      </div>
    </tk-card>

    @if (tickets.error()) {
      <tk-alert tone="danger" heading="Couldn't load tickets">
        {{ errorText() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="tickets.reload()">
          Try again
        </button>
      </tk-alert>
    } @else {
      <tk-card flush>
        <div class="overflow-x-auto">
          <table tkTable hover class="min-w-[900px]">
            <thead>
              <tr>
                <th scope="col">Ticket</th>
                <th scope="col">Requester</th>
                <th scope="col">Priority</th>
                <th scope="col">Status</th>
                <th scope="col">Assignee</th>
                <th scope="col">SLA</th>
                <th scope="col" class="text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              @if (tickets.isLoading()) {
                <!-- Skeletons match the real row height, so nothing jumps when
                     the data lands. -->
                @for (row of skeletonRows; track row) {
                  <tr>
                    @for (cell of skeletonCells; track cell) {
                      <td><span tkSkeleton class="h-4 w-full max-w-[160px]"></span></td>
                    }
                  </tr>
                }
              } @else {
                @for (ticket of rows(); track ticket.id) {
                  <tr class="cursor-pointer" (click)="open(ticket)">
                    <td>
                      <a
                        class="block max-w-[280px] truncate font-semibold hover:text-primary"
                        [routerLink]="['/dashboard/tickets', ticket.id]"
                        (click)="$event.stopPropagation()"
                      >
                        {{ ticket.subject }}
                      </a>
                      <span class="text-meta text-muted-foreground">
                        #{{ ticket.id.slice(0, 8) }} · {{ ticket.channel }}
                      </span>
                    </td>
                    <td>
                      <span class="flex items-center gap-2">
                        <tk-avatar [name]="requesterOf(ticket)" [size]="26" round fallback="G" />
                        <span class="truncate">{{ requesterOf(ticket) }}</span>
                      </span>
                    </td>
                    <td>
                      <tk-badge [tone]="priorityOf(ticket).tone">{{ priorityOf(ticket).label }}</tk-badge>
                    </td>
                    <td>
                      <tk-badge [tone]="statusOf(ticket).tone" dot>{{ statusOf(ticket).label }}</tk-badge>
                    </td>
                    <td class="text-muted-foreground">
                      {{ ticket.assignee?.name ?? ticket.assignee?.email ?? 'Unassigned' }}
                    </td>
                    <td>
                      @if (sla(ticket); as state) {
                        <tk-badge [tone]="state.tone">{{ state.prefix }} {{ state.label }}</tk-badge>
                      } @else {
                        <span class="text-muted-foreground">—</span>
                      }
                    </td>
                    <td class="text-right text-meta text-muted-foreground">
                      {{ ago(ticket.updatedAt) }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="p-0">
                      @if (hasFilters()) {
                        <tk-empty-state
                          icon="filter"
                          heading="No tickets match"
                          description="No ticket matches these filters. Try widening them."
                        >
                          <button tkButton variant="secondary" (click)="clearFilters()">
                            Clear filters
                          </button>
                        </tk-empty-state>
                      } @else {
                        <tk-empty-state
                          icon="ticket"
                          heading="No tickets yet"
                          description="When a customer emails, chats or submits the form, their ticket lands here."
                        >
                          <a tkButton routerLink="/dashboard/tickets/new">Create the first ticket</a>
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

  // Bound from the query string by `withComponentInputBinding()`.
  readonly view = input('');
  readonly priority = input('');
  readonly q = input('');
  readonly page = input('');

  protected readonly pageSize = PAGE_SIZE;
  protected readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);
  protected readonly skeletonCells = Array.from({ length: 7 }, (_, i) => i);

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

  protected readonly heading = computed(() => {
    switch (this.view()) {
      case 'mine':
        return 'Assigned to me';
      case '':
        return 'Tickets';
      default:
        return toneFor(STATUS_TONE, this.view()).label;
    }
  });

  protected readonly summary = computed(() => {
    if (this.tickets.isLoading()) return 'Loading…';
    const total = this.total();
    return `${total} ${total === 1 ? 'ticket' : 'tickets'}${this.hasFilters() ? ' matching these filters' : ''}`;
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

  protected requesterOf(ticket: TicketSummary): string {
    return (
      ticket.requester?.name ??
      ticket.requester?.email ??
      ticket.guestName ??
      ticket.guestEmail ??
      'Guest'
    );
  }

  protected statusOf = (ticket: TicketSummary) => toneFor(STATUS_TONE, ticket.status);
  protected priorityOf = (ticket: TicketSummary) => toneFor(PRIORITY_TONE, ticket.priority);
  protected sla = slaState;
  protected ago = timeAgo;
}
