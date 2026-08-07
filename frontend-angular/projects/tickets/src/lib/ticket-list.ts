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
  isTerminalCategory,
  slaState,
  timeAgo,
  toneFor,
  type TicketListParams,
  type TicketSort,
  type TicketSummary,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Icon,
  Pagination,
  Select,
  SelectOption,
  ToastService,
  SkeletonDirective,
  TableDirective,
  type IconName,
} from '@trackly/ui';
import { ResolveDialog, type ResolvePayload } from './resolve-dialog';
import {
  TicketFacetsRail,
  UNASSIGNED_FACET,
  type FacetKey,
  type FacetToggle,
} from './ticket-facets';

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

/**
 * A saved view maps to a status **category**, not a status.
 *
 * "Open" has to mean every status in the open category. A workspace with "Todo"
 * and "Estimation required" would otherwise have an Open view showing neither.
 */
const VIEW_CATEGORY: Record<string, string | undefined> = {
  open: 'open',
  pending: 'pending',
  active: 'active',
  resolved: 'resolved',
  closed: 'closed',
};

/** Sortable columns. Anything else in the URL falls back to `updated`. */
const SORTS: readonly TicketSort[] = ['updated', 'created', 'priority', 'status', 'subject', 'due'];

/** `"open,pending"` → `['open', 'pending']`, and `''` → `[]`. */
function split(value: string): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

/**
 * An empty array is not an empty filter — it is "no filter", and sending it as
 * `[]` would serialise to nothing useful anyway. Undefined says so plainly.
 */
function orUndefined(values: string[]): string[] | undefined {
  return values.length ? values : undefined;
}

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
    Drawer,
    EmptyState,
    Icon,
    Pagination,
    ResolveDialog,
    Select,
    SelectOption,
    SkeletonDirective,
    TableDirective,
    TicketFacetsRail,
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
    <tk-card flush class="mb-4">
      <!-- One row: search grows, selects shrink to fit. Padding lives here
           rather than on the card, so the bar hugs its controls. -->
      <div class="flex flex-wrap items-center gap-2 p-2.5">
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

        <tk-select
          auto
          size="sm"
          [ariaLabel]="'tickets.columns.status' | transloco"
          [value]="view()"
          (valueChange)="setParam('view', $event)"
        >
          <tk-option value="" [label]="'tickets.allStatus' | transloco" />
          <tk-option value="open" [label]="'status.open' | transloco" />
          <tk-option value="pending" [label]="'status.pending' | transloco" />
          <tk-option value="active" [label]="'status.active' | transloco" />
          <tk-option value="resolved" [label]="'status.resolved' | transloco" />
          <tk-option value="closed" [label]="'status.closed' | transloco" />
          <tk-option value="mine" [label]="'tickets.assignedToMe' | transloco" />
          <tk-option value="mentioned" [label]="'nav.items.mentioned' | transloco" />
          <tk-option value="watching" [label]="'nav.items.watching' | transloco" />
        </tk-select>

        <tk-select
          auto
          size="sm"
          [ariaLabel]="'tickets.columns.priority' | transloco"
          [value]="priority()"
          (valueChange)="setParam('priority', $event)"
        >
          <tk-option value="" [label]="'tickets.allPriority' | transloco" />
          <tk-option value="urgent" [label]="'priority.urgent' | transloco" />
          <tk-option value="high" [label]="'priority.high' | transloco" />
          <tk-option value="medium" [label]="'priority.medium' | transloco" />
          <tk-option value="low" [label]="'priority.low' | transloco" />
        </tk-select>

        <!-- Filters live behind this button, at every width. They were a
             permanent left rail first; on a real workspace that spent a third
             of the screen on a control used a few times a day, while the table
             — the thing people are actually reading — got squeezed. -->
        <button tkButton variant="outline" size="sm" (click)="openFilters()">
          <tk-icon name="filter" [size]="15" />
          {{ 'tickets.filters.heading' | transloco }}
          @if (facetCount(); as n) {
            <span class="rounded-full bg-primary px-1.5 text-meta font-bold text-primary-foreground">{{ n }}</span>
          }
        </button>

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
              <!-- Sortable headers carry aria-sort so a screen reader knows
                   which column is ordering the table and which way. -->
              <tr>
                <th scope="col" [attr.aria-sort]="ariaSort('subject')">
                  <button type="button" class="th-sort" (click)="sortBy('subject')">
                    {{ 'tickets.columns.ticket' | transloco }}
                    @if (sort() === 'subject') {
                      <tk-icon name="chevron-down" [size]="13" class="th-sort-icon" [class.is-asc]="!descending()" />
                    }
                  </button>
                </th>
                <th scope="col">{{ 'tickets.columns.requester' | transloco }}</th>
                <th scope="col" class="hidden lg:table-cell">{{ 'tickets.columns.category' | transloco }}</th>
                <th scope="col" [attr.aria-sort]="ariaSort('priority')">
                  <button type="button" class="th-sort" (click)="sortBy('priority')">
                    {{ 'tickets.columns.priority' | transloco }}
                    @if (sort() === 'priority') {
                      <tk-icon name="chevron-down" [size]="13" class="th-sort-icon" [class.is-asc]="!descending()" />
                    }
                  </button>
                </th>
                <th scope="col" [attr.aria-sort]="ariaSort('status')">
                  <button type="button" class="th-sort" (click)="sortBy('status')">
                    {{ 'tickets.columns.status' | transloco }}
                    @if (sort() === 'status') {
                      <tk-icon name="chevron-down" [size]="13" class="th-sort-icon" [class.is-asc]="!descending()" />
                    }
                  </button>
                </th>
                <th scope="col">{{ 'tickets.columns.assignee' | transloco }}</th>
                <th scope="col" class="hidden lg:table-cell" [attr.aria-sort]="ariaSort('due')">
                  <button type="button" class="th-sort" (click)="sortBy('due')">
                    {{ 'tickets.columns.sla' | transloco }}
                    @if (sort() === 'due') {
                      <tk-icon name="chevron-down" [size]="13" class="th-sort-icon" [class.is-asc]="!descending()" />
                    }
                  </button>
                </th>
                <th scope="col" class="hidden md:table-cell col-right" [attr.aria-sort]="ariaSort('updated')">
                  <button type="button" class="th-sort" (click)="sortBy('updated')">
                    {{ 'tickets.columns.updated' | transloco }}
                    @if (sort() === 'updated') {
                      <tk-icon name="chevron-down" [size]="13" class="th-sort-icon" [class.is-asc]="!descending()" />
                    }
                  </button>
                </th>
                <th scope="col" class="col-right">{{ 'tickets.columns.actions' | transloco }}</th>
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
                        <tk-avatar
                          [name]="requesterOf(ticket)"
                          [imageUrl]="ticket.requester?.avatarUrl ?? null"
                          [size]="26"
                          round
                          fallback="G"
                        />
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
                      <tk-badge [tone]="statusOf(ticket).tone" dot>{{ ticket.statusName }}</tk-badge>
                    </td>
                    <td>
                      @if (ticket.assignee; as agent) {
                        <span class="flex items-center gap-2">
                          <tk-avatar [name]="agent.name ?? agent.email" [imageUrl]="agent.avatarUrl" [size]="24" round />
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
                    <td class="col-right" (click)="$event.stopPropagation()">
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
                          [disabled]="isFinished(ticket)"
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

    <tk-drawer [(open)]="filtersOpen" [heading]="'tickets.filters.heading' | transloco">
      <tk-ticket-facets
        [facets]="facets.value()"
        [loading]="facets.isLoading()"
        [selected]="selectedFacets()"
        (toggled)="onFacet($event)"
        (clear)="clearFilters()"
      />
    </tk-drawer>

    <!-- The row action opens the same dialog the detail screen uses: the API
         requires a resolution note either way, so a one-click resolve from here
         would just be a 400 with extra steps. The subject is passed because in
         a list the row that was clicked stops being obvious the moment a modal
         covers it. -->
    <tk-resolve-dialog
      [(open)]="resolveOpen"
      [subject]="resolving()?.subject"
      [saving]="resolveSaving()"
      [error]="resolveError()"
      (confirmed)="applyResolution($event)"
    />
  `,
})
export class TicketList {
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly transloco = inject(TranslocoService);
  private readonly toast = inject(ToastService);

  protected readonly resolveOpen = signal(false);
  protected readonly resolving = signal<TicketSummary | null>(null);
  protected readonly resolveSaving = signal(false);
  protected readonly resolveError = signal<string | null>(null);
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

  /**
   * The facet selections, comma-separated in the URL.
   *
   * Short names because seven of them share the query string with the existing
   * params, and `?st=open,pending&as=none` stays a link somebody can read.
   * Repeated params (`?st=open&st=pending`) would be more conventional but the
   * router's own `queryParams` merge does not express "replace this list", so
   * one string per group is both shorter and easier to write correctly.
   */
  readonly st = input('', { transform: fromQuery });
  readonly pr = input('', { transform: fromQuery });
  readonly ch = input('', { transform: fromQuery });
  readonly tm = input('', { transform: fromQuery });
  readonly cat = input('', { transform: fromQuery });
  readonly as = input('', { transform: fromQuery });
  readonly tg = input('', { transform: fromQuery });

  readonly sortParam = input('', { alias: 'sort', transform: fromQuery });
  readonly dir = input('', { transform: fromQuery });

  protected readonly filtersOpen = signal(false);

  protected readonly sort = computed<TicketSort>(() => {
    const value = this.sortParam();
    return SORTS.includes(value as TicketSort) ? (value as TicketSort) : 'updated';
  });

  /** Descending unless the URL says otherwise — newest-first is what a queue means. */
  protected readonly descending = computed(() => this.dir() !== 'asc');

  protected readonly pageSize = PAGE_SIZE;
  protected readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);

  /** Local mirror of `q`, so typing doesn't push a history entry per keystroke. */
  protected readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly pageNumber = computed(() => Math.max(1, Number(this.page()) || 1));

  /**
   * Everything the server needs, assembled once.
   *
   * Shared by the list and the facet counts so the two can never describe
   * different filter states — which is the failure that makes a facet rail
   * untrustworthy: counts that do not add up to the rows underneath them.
   */
  private readonly filters = computed(() => {
    const assignees = split(this.as());
    const view = this.view();
    // The sidebar's saved views and the rail's status group are two doors to the
    // same filter. The rail wins when it has anything in it, because it is the
    // one the user just touched.
    const statuses = split(this.st());
    const viewCategory = VIEW_CATEGORY[view];

    return {
      status: orUndefined(statuses),
      // The rail narrows by status; the sidebar narrows by category. Both can
      // be set, and together they read as "a status in this category".
      category: viewCategory ? [viewCategory] : undefined,
      priority: split(this.pr()).length ? split(this.pr()) : this.priority() || undefined,
      channel: orUndefined(split(this.ch())),
      teamId: orUndefined(split(this.tm())),
      categoryId: orUndefined(split(this.cat())),
      tag: orUndefined(split(this.tg())),
      // "Nobody" has no id, so it travels as its own flag rather than as a
      // magic assignee value the server would have to know about.
      assigneeId: orUndefined(assignees.filter((id) => id !== UNASSIGNED_FACET)),
      unassigned: assignees.includes(UNASSIGNED_FACET) || undefined,
      mentioned: view === 'mentioned' || undefined,
      watching: view === 'watching' || undefined,
      search: this.q() || undefined,
    } satisfies TicketListParams;
  });

  protected readonly tickets = resource({
    params: () => ({
      filters: this.filters(),
      mine: this.view() === 'mine',
      me: this.session.user()?.id ?? '',
      sort: this.sort(),
      desc: this.descending(),
      page: this.pageNumber(),
    }),
    loader: ({ params }) =>
      this.api.list({
        ...params.filters,
        // "Assigned to me" is the sidebar's shorthand, and it only means
        // anything once the session has resolved.
        assigneeId: params.mine ? params.me : params.filters.assigneeId,
        sort: params.sort,
        desc: params.desc,
        page: params.page,
        pageSize: PAGE_SIZE,
      }),
  });

  /**
   * Counts for the filter panel.
   *
   * A second request rather than a field on the list response: it is a
   * different shape of query — seven grouped counts, each excluding its own
   * filter — and paging the list must not recompute them.
   *
   * **Only fetched once the panel has been opened.** Seven GROUP BYs on every
   * visit to the ticket list, for a panel most visits never open, is a real cost
   * for nothing. Once opened it stays live, so changing a filter updates the
   * counts underneath the tick that changed them.
   */
  private readonly facetsWanted = signal(false);

  protected readonly facets = resource({
    params: () => ({
      wanted: this.facetsWanted(),
      filters: this.filters(),
      mine: this.view() === 'mine',
      me: this.session.user()?.id ?? '',
    }),
    loader: ({ params }) =>
      params.wanted
        ? this.api.facets({
            ...params.filters,
            assigneeId: params.mine ? params.me : params.filters.assigneeId,
          })
        : Promise.resolve(undefined),
  });

  protected openFilters(): void {
    this.facetsWanted.set(true);
    this.filtersOpen.set(true);
  }

  protected readonly selectedFacets = computed<Partial<Record<FacetKey, readonly string[]>>>(() => ({
    status: split(this.st()),
    priority: split(this.pr()),
    channel: split(this.ch()),
    team: split(this.tm()),
    category: split(this.cat()),
    assignee: split(this.as()),
    tag: split(this.tg()),
  }));

  /** How many facet values are ticked — the badge on the mobile Filters button. */
  protected readonly facetCount = computed(() => {
    const total = Object.values(this.selectedFacets()).reduce((sum, v) => sum + (v?.length ?? 0), 0);
    return total || null;
  });

  protected readonly rows = computed(() => this.tickets.value()?.items ?? []);
  protected readonly total = computed(() => this.tickets.value()?.total ?? 0);
  protected readonly errorText = computed(() => errorMessage(this.tickets.error()));

  protected readonly hasFilters = computed(
    () => !!(this.view() || this.priority() || this.q() || this.facetCount()),
  );

  protected readonly headingKey = computed(() => {
    switch (this.view()) {
      case 'mine':
        return 'tickets.assignedToMe';
      case 'mentioned':
        return 'nav.items.mentioned';
      case 'watching':
        return 'nav.items.watching';
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
    //
    // `untracked` is load-bearing. Reading search() as a dependency makes this
    // effect re-run on every keystroke — and at that moment the URL is still
    // one debounce behind, so it "corrects" the box back to the old value and
    // the field wipes itself as you type. It must depend on q() alone.
    effect(() => {
      const fromUrl = this.q();
      untracked(() => {
        if (fromUrl !== this.search()) this.search.set(fromUrl);
      });
    });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    // Debounced, and `replaceUrl` so a search doesn't bury the previous page in
    // history one character at a time.
    this.searchTimer = setTimeout(() => this.setParam('q', value, true), 300);
  }

  /** Which URL param each facet group writes to. */
  private static readonly FACET_PARAM: Record<FacetKey, string> = {
    status: 'st',
    priority: 'pr',
    channel: 'ch',
    team: 'tm',
    category: 'cat',
    assignee: 'as',
    tag: 'tg',
  };

  private facetValues(key: FacetKey): string[] {
    return split(this.rawFacet(key));
  }

  private rawFacet(key: FacetKey): string {
    switch (key) {
      case 'status':
        return this.st();
      case 'priority':
        return this.pr();
      case 'channel':
        return this.ch();
      case 'team':
        return this.tm();
      case 'category':
        return this.cat();
      case 'assignee':
        return this.as();
      default:
        return this.tg();
    }
  }

  /**
   * Ticks or unticks one value.
   *
   * Picking a status also clears a status-shaped saved view, because the two
   * mean the same thing and leaving both set would show a filter the rail
   * cannot represent — "Open" in the sidebar and "Pending" in the rail, with the
   * results obeying neither obviously.
   */
  protected onFacet({ key, value }: FacetToggle): void {
    const current = this.facetValues(key);
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];

    const params: Record<string, string | null> = {
      [TicketList.FACET_PARAM[key]]: next.length ? next.join(',') : null,
      page: null,
    };
    if (key === 'status' && VIEW_CATEGORY[this.view()]) params['view'] = null;

    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }

  /**
   * Clicking the active column flips the direction; clicking another switches to
   * it, starting descending — the useful end of every column here (newest,
   * most urgent, soonest due).
   */
  protected sortBy(column: TicketSort): void {
    const active = this.sort() === column;
    const desc = active ? !this.descending() : true;
    void this.router.navigate([], {
      queryParams: {
        sort: column === 'updated' && desc ? null : column,
        dir: desc ? null : 'asc',
        page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  protected ariaSort(column: TicketSort): 'ascending' | 'descending' | 'none' {
    if (this.sort() !== column) return 'none';
    return this.descending() ? 'descending' : 'ascending';
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

  /**
   * Optimistic-free: reload the list so the row reflects what the server did.
   *
   * Confirmed first, and here more than anywhere: this is a small icon in a
   * dense table, one column away from "view", and the row it belongs to is only
   * obvious while the pointer is on it. The dialog names the ticket, so a slip
   * on the wrong row is caught by reading rather than by undoing.
   */
  protected resolve(ticket: TicketSummary): void {
    this.resolveError.set(null);
    this.resolving.set(ticket);
    this.resolveOpen.set(true);
  }

  protected async applyResolution(payload: ResolvePayload): Promise<void> {
    const ticket = this.resolving();
    if (!ticket) return;

    this.resolveSaving.set(true);
    this.resolveError.set(null);
    try {
      await this.api.update(ticket.id, {
        status: payload.status,
        resolutionNote: payload.note,
        resolutionLink: payload.link,
        timeSpentMinutes: payload.minutes,
      });
      this.resolveOpen.set(false);
      this.tickets.reload();
      this.toast.success(this.transloco.translate('tickets.resolved'));
    } catch (err) {
      // Inline in the dialog, not a toast: the note they typed is still on
      // screen and a toast would send them back to a form they can no longer see.
      this.resolveError.set(errorMessage(err));
    } finally {
      this.resolveSaving.set(false);
    }
  }

  /**
   * "Guest" and "no customer" are different states and must not share a label.
   * A guest is a real person who submitted anonymously; an agent-raised ticket
   * with nobody attached is waiting for someone to link a customer, and calling
   * that "Guest" hides work that still needs doing.
   */
  protected requesterOf(ticket: TicketSummary): string {
    if (ticket.requester) return ticket.requester.name ?? ticket.requester.email ?? '';
    if (ticket.guestName || ticket.guestEmail) {
      return ticket.guestName ?? ticket.guestEmail ?? this.transloco.translate('tickets.guest');
    }
    return this.transloco.translate('tickets.noCustomer');
  }

  /** Tone by category — a workspace status name has no colour this map knows. */
  protected statusOf = (ticket: TicketSummary) => toneFor(STATUS_TONE, ticket.statusCategory);

  /** The work is over, whatever this workspace calls that state. */
  protected isFinished = (ticket: TicketSummary) => isTerminalCategory(ticket.statusCategory);
  protected priorityOf = (ticket: TicketSummary) => toneFor(PRIORITY_TONE, ticket.priority);
  protected sla = slaState;
  protected ago = timeAgo;
}
