import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  SessionStore,
  TicketsApi,
  errorMessage,
  formatDate,
  fromQuery,
  timeAgo,
  type CustomerRow,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Modal,
  PageHeader,
  Pagination,
  SkeletonDirective,
  StatCard,
  TableDirective,
  ToastService,
} from '@trackly/ui';
import { CustomerForm } from './customer-form';

/**
 * Everyone who raises tickets, browsable and countable.
 *
 * **The number that earns this screen is "never signed in".** A customer with
 * tickets who has never logged in is somebody emailing the desk who does not know
 * the portal exists — which is a thing a workspace can fix, and which nothing in
 * Trackly surfaced before. The rest of the page is the register: how many there
 * are, who is active, who keeps coming back.
 *
 * **Filters live in the URL** (`?q=&signedIn=no&page=2`), so a lead can send
 * somebody "these forty people need a portal invite" as a link, and Back works.
 *
 * Rows go to the existing profile page, which is where a customer is edited. This
 * screen only adds and finds; nothing about one person is duplicated here.
 */
@Component({
  selector: 'tk-customer-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Avatar,
    Badge,
    Button,
    Card,
    CustomerForm,
    EmptyState,
    Icon,
    Modal,
    PageHeader,
    Pagination,
    SkeletonDirective,
    StatCard,
    TableDirective,
  ],
  template: `
    <tk-page-header [title]="'customers.title' | transloco" [subtitle]="'customers.subtitle' | transloco">
      <button tkButton page-actions (click)="addOpen.set(true)">
        <tk-icon name="user-plus" [size]="16" />
        {{ 'customers.add' | transloco }}
      </button>
    </tk-page-header>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <tk-stat-card
        [label]="'customers.stats.total' | transloco"
        icon="users"
        tone="primary"
        [value]="summary.value()?.total"
      />
      <tk-stat-card
        [label]="'customers.stats.signedIn' | transloco"
        icon="user-check"
        tone="success"
        [value]="summary.value()?.signedIn"
      />
      <!-- The actionable one: they have raised tickets and never found the portal.
           Clicking it filters the list down to exactly those people. -->
      <tk-stat-card
        [label]="'customers.stats.neverSignedIn' | transloco"
        icon="user-x"
        [tone]="(summary.value()?.neverSignedInWithTickets ?? 0) > 0 ? 'warning' : 'success'"
        [value]="summary.value()?.neverSignedInWithTickets"
        clickable
        routerLink="/dashboard/customers"
        [queryParams]="{ signedIn: 'no' }"
      />
      <tk-stat-card
        [label]="'customers.stats.withOpen' | transloco"
        icon="folder-open"
        tone="info"
        [value]="summary.value()?.withOpenTickets"
      />
    </div>

    <tk-card dense class="mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-muted px-3">
          <tk-icon name="search" [size]="16" class="text-muted-foreground" />
          <input
            class="w-full bg-transparent text-body outline-none"
            type="search"
            [placeholder]="'customers.searchPlaceholder' | transloco"
            [attr.aria-label]="'customers.searchPlaceholder' | transloco"
            [ngModel]="search()"
            (ngModelChange)="onSearch($event)"
          />
        </div>

        <!-- Segmented, not a dropdown: three mutually exclusive answers that are
             all worth reading at a glance, and the middle one is the point of the
             screen. -->
        <div class="flex flex-wrap gap-1">
          @for (option of signedInOptions; track option.value) {
            <button
              type="button"
              class="composer-tab"
              [class.is-active]="signedIn() === option.value"
              [attr.aria-pressed]="signedIn() === option.value"
              (click)="setParam('signedIn', option.value)"
            >
              {{ option.labelKey | transloco }}
            </button>
          }
        </div>

        <label class="ml-auto flex items-center gap-2 text-meta text-muted-foreground">
          <input
            type="checkbox"
            class="size-4 accent-primary"
            [checked]="inactive() === '1'"
            (change)="setParam('inactive', inactive() === '1' ? '' : '1')"
          />
          {{ 'customers.showInactive' | transloco }}
        </label>
      </div>
    </tk-card>

    @if (customers.error()) {
      <tk-alert tone="danger" [heading]="'customers.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="customers.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <tk-card flush>
        <div class="overflow-x-auto">
          <table tkTable hover class="min-w-[920px]">
            <thead>
              <tr>
                <th scope="col">
                  <button type="button" class="font-inherit hover:text-foreground" (click)="setParam('sort', 'name')">
                    {{ 'customers.columns.customer' | transloco }}
                  </button>
                </th>
                <th scope="col">{{ 'customers.columns.company' | transloco }}</th>
                <th scope="col">{{ 'customers.columns.contact' | transloco }}</th>
                <th scope="col" class="col-right">
                  <button type="button" class="font-inherit hover:text-foreground" (click)="setParam('sort', 'tickets')">
                    {{ 'customers.columns.tickets' | transloco }}
                  </button>
                </th>
                <th scope="col" class="col-right">{{ 'customers.columns.open' | transloco }}</th>
                <th scope="col">
                  <button type="button" class="font-inherit hover:text-foreground" (click)="setParam('sort', 'lastSeen')">
                    {{ 'customers.columns.signedIn' | transloco }}
                  </button>
                </th>
                <th scope="col">{{ 'customers.columns.added' | transloco }}</th>
              </tr>
            </thead>
            <tbody>
              @if (customers.isLoading() && !customers.value()) {
                @for (row of skeletonRows; track row) {
                  <tr><td colspan="7"><span tkSkeleton class="block h-5 w-full"></span></td></tr>
                }
              } @else {
                @for (customer of rows(); track customer.id) {
                  <tr class="cursor-pointer" (click)="open(customer)">
                    <td>
                      <span class="flex items-center gap-2">
                        <tk-avatar
                          [name]="displayName(customer)"
                          [imageUrl]="customer.avatarUrl"
                          [size]="28"
                          round
                        />
                        <span class="min-w-0">
                          <span class="block truncate font-semibold" [class.text-muted-foreground]="!customer.isActive">
                            {{ displayName(customer) }}
                          </span>
                          @if (!customer.isActive) {
                            <tk-badge tone="neutral">{{ 'customers.inactive' | transloco }}</tk-badge>
                          }
                        </span>
                      </span>
                    </td>
                    <td class="text-body">{{ customer.company || '—' }}</td>
                    <td>
                      <span class="block truncate text-body">{{ customer.email || '—' }}</span>
                      @if (customer.phone) {
                        <span class="block text-meta text-muted-foreground">{{ customer.phone }}</span>
                      }
                    </td>
                    <td class="col-right font-mono text-body">{{ customer.totalTickets }}</td>
                    <td class="col-right">
                      @if (customer.openTickets) {
                        <tk-badge tone="warning">{{ customer.openTickets }}</tk-badge>
                      } @else {
                        <span class="text-meta text-muted-foreground">0</span>
                      }
                    </td>
                    <td>
                      <!-- Amber, not grey, when they have tickets and have never
                           signed in: that combination is the one somebody can act
                           on. A contact typed in once and never used is not. -->
                      @if (customer.lastLoginAt) {
                        <span class="text-meta text-muted-foreground">{{ ago(customer.lastLoginAt) }}</span>
                      } @else if (customer.totalTickets) {
                        <span class="text-meta font-semibold text-warning-ink">
                          {{ 'customers.neverSignedIn' | transloco }}
                        </span>
                      } @else {
                        <span class="text-meta text-muted-foreground">
                          {{ 'customers.neverSignedIn' | transloco }}
                        </span>
                      }
                    </td>
                    <td class="text-meta text-muted-foreground">{{ added(customer) }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="p-0">
                      <tk-empty-state
                        icon="users"
                        [heading]="(filtered() ? 'customers.empty.filteredHeading' : 'customers.empty.heading') | transloco"
                        [description]="(filtered() ? 'customers.empty.filteredBody' : 'customers.empty.body') | transloco"
                      />
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <tk-pagination
          card-footer
          [page]="pageNumber()"
          (pageChange)="setParam('page', $event === 1 ? '' : String($event))"
          [total]="total()"
          [pageSize]="pageSize"
        />
      </tk-card>
    }

    <tk-modal [(open)]="addOpen" [heading]="'customers.add' | transloco">
      <tk-customer-form #form />
      <div modal-footer>
        <button tkButton variant="ghost" [disabled]="saving()" (click)="addOpen.set(false)">
          {{ 'common.cancel' | transloco }}
        </button>
        <button tkButton [disabled]="saving() || !form.valid()" (click)="create(form)">
          {{ 'customers.add' | transloco }}
        </button>
      </div>
    </tk-modal>
  `,
})
export class CustomerList {
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly session = inject(SessionStore);

  /**
   * URL-bound by `withComponentInputBinding()`.
   *
   * `fromQuery` on every one of them: clearing a filter removes the param, and
   * the router then writes `undefined` rather than restoring the `''` default.
   */
  readonly q = input('', { transform: fromQuery });
  readonly signedIn = input('', { transform: fromQuery });
  readonly inactive = input('', { transform: fromQuery });
  readonly sort = input('', { transform: fromQuery });
  readonly page = input('', { transform: fromQuery });

  protected readonly pageSize = 25;
  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5];

  protected readonly signedInOptions = [
    { value: '', labelKey: 'customers.filters.all' },
    { value: 'yes', labelKey: 'customers.filters.signedIn' },
    { value: 'no', labelKey: 'customers.filters.neverSignedIn' },
  ];

  /** Local mirror of `q`, so typing is instant while the URL is debounced. */
  protected readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly addOpen = signal(false);
  protected readonly saving = signal(false);

  protected readonly summary = resource({ loader: () => this.api.customerSummary() });

  protected readonly customers = resource({
    params: () => ({
      search: this.q(),
      signedIn: this.signedIn(),
      includeInactive: this.inactive() === '1',
      sort: this.sort(),
      page: Number(this.page()) || 1,
    }),
    loader: ({ params }) =>
      this.api.customers({
        search: params.search || undefined,
        signedIn: params.signedIn || undefined,
        includeInactive: params.includeInactive,
        sort: params.sort || undefined,
        page: params.page,
        pageSize: this.pageSize,
      }),
  });

  protected readonly rows = computed(() => this.customers.value()?.items ?? []);
  protected readonly total = computed(() => this.customers.value()?.total ?? 0);
  protected readonly pageNumber = computed(() => Number(this.page()) || 1);
  protected readonly loadError = computed(() => errorMessage(this.customers.error()));

  /** Whether an empty list is empty because of a filter or because there is nothing. */
  protected readonly filtered = computed(
    () => this.q().trim().length > 0 || this.signedIn().length > 0,
  );

  /** Exposed for the pagination handler, which needs to stringify a number. */
  protected readonly String = String;

  protected displayName(customer: CustomerRow): string {
    return customer.name || customer.email || this.transloco.translate('customers.unnamed');
  }

  protected ago(iso: string): string {
    return timeAgo(iso);
  }

  protected added(customer: CustomerRow): string {
    return formatDate(customer.createdAt);
  }

  protected open(customer: CustomerRow): void {
    void this.router.navigate(['/dashboard/customers', customer.id]);
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.setParam('q', value), 300);
  }

  /**
   * Writes one filter to the URL.
   *
   * **Any filter change resets the page.** Page 3 of the old filter is meaningless
   * under the new one, and landing on an empty page 3 reads as "no results".
   * `replaceUrl` so a search does not fill the history stack.
   */
  protected setParam(key: string, value: string): void {
    const queryParams: Record<string, string | null> = { [key]: value || null };
    if (key !== 'page') queryParams['page'] = null;
    void this.router.navigate([], {
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected async create(form: CustomerForm): Promise<void> {
    if (!form.valid() || this.saving()) return;
    this.saving.set(true);
    try {
      const { body: customer, created } = await this.api.createCustomerChecked(form.body());
      this.addOpen.set(false);
      form.reset();
      const name = customer.name || customer.email || '';

      // Two different outcomes behind one button, so two different endings.
      //
      // **Created** — stay put. The modal already collects every field the profile
      // page edits, so there is nothing left to fill in there, and navigating away
      // would throw out the search, filter and page the agent was in. Watching the
      // row appear and the count tick up IS the confirmation this screen exists to
      // give, and it leaves the agent able to add the next person.
      //
      // **Already existed** — open them, and say so. The endpoint is get-or-create,
      // so nothing was written and nothing will appear; a success toast beside an
      // unchanged list would tell the agent they had recorded somebody when they
      // had not. Their profile is also the answer to the question the agent was
      // really asking, which is what we already know about this person.
      if (created) {
        this.toast.success(this.transloco.translate('customers.added', { name }));
        // Both, because the summary counts what the list shows and a stale headline
        // beside a fresh row is worse than a slow one.
        this.customers.reload();
        this.summary.reload();
      } else {
        this.toast.info(this.transloco.translate('customers.alreadyExists', { name }));
        void this.router.navigate(['/dashboard/customers', customer.id]);
      }
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Kept for the template's role checks if the add button ever narrows to admin. */
  protected readonly isAdmin = computed(() => this.session.isAdmin());
}
