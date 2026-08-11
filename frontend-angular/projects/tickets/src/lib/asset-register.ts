import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  PRIORITY_TONE,
  STATUS_TONE,
  TicketsApi,
  errorMessage,
  formatDate,
  fromQuery,
  toneFor,
  type Asset,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Card,
  Drawer,
  EmptyState,
  Icon,
  InputDirective,
  PageHeader,
  SkeletonDirective,
  StatCard,
  TableDirective,
} from '@trackly/ui';

/**
 * The asset register, and what it has cost in tickets.
 *
 * **Two questions on one screen, and they are not the same question.** The
 * summary at the top is an audit: how much do we own, how much of it is out with
 * somebody, where is it. The table below is a diagnosis: which of these machines
 * keeps coming back. Admin's Catalogue screen is where the register is *edited*;
 * this is where it is *read*, which is why it is agent-facing — "is there a spare
 * laptop" and "has this printer done this before" are support questions, not
 * configuration ones.
 *
 * Clicking a row opens its ticket history in a drawer rather than navigating: the
 * useful move after reading one asset's history is reading the next one's, and a
 * full page change loses the list you were working down.
 *
 * Retired assets are excluded unless asked for. They are kept so old tickets
 * still render a name, not so they pad a count of what the workspace owns.
 */
@Component({
  selector: 'tk-asset-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Avatar,
    Badge,
    Card,
    Drawer,
    EmptyState,
    Icon,
    PageHeader,
    SkeletonDirective,
    StatCard,
    TableDirective,
  ],
  template: `
    <tk-page-header
      [title]="'assets.title' | transloco"
      [subtitle]="'assets.subtitle' | transloco"
    />

    <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <tk-stat-card
        [label]="'assets.stats.total' | transloco"
        icon="hard-drive"
        tone="primary"
        [value]="summary.value()?.total"
      />
      <tk-stat-card
        [label]="'assets.stats.assigned' | transloco"
        icon="user-check"
        tone="info"
        [value]="summary.value()?.assigned"
      />
      <tk-stat-card
        [label]="'assets.stats.unassigned' | transloco"
        icon="inbox"
        tone="neutral"
        [value]="summary.value()?.unassigned"
      />
      <!-- The one number here that is about today rather than about inventory. -->
      <tk-stat-card
        [label]="'assets.stats.inTrouble' | transloco"
        icon="alert-triangle"
        tone="warning"
        [value]="summary.value()?.inTrouble"
      />
    </div>

    @if (summary.value(); as totals) {
      @if (totals.total) {
        <div class="mb-4 grid gap-3 lg:grid-cols-3">
          <tk-card [heading]="'assets.byKind' | transloco">
            @if (totals.byKind.length) {
              <ul class="space-y-1.5">
                @for (bucket of totals.byKind; track bucket.value) {
                  <li class="flex items-baseline justify-between gap-3 text-body">
                    <span class="min-w-0 truncate">{{ label(bucket.value) }}</span>
                    <span class="font-mono font-bold">{{ bucket.count }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-meta text-muted-foreground">{{ 'assets.noBuckets' | transloco }}</p>
            }
          </tk-card>

          <tk-card [heading]="'assets.byLocation' | transloco">
            @if (totals.byLocation.length) {
              <ul class="space-y-1.5">
                @for (bucket of totals.byLocation; track bucket.value) {
                  <li class="flex items-baseline justify-between gap-3 text-body">
                    <span class="flex min-w-0 items-center gap-1.5">
                      <tk-icon name="map-pin" [size]="13" class="shrink-0 text-muted-foreground" />
                      <span class="truncate">{{ label(bucket.value) }}</span>
                    </span>
                    <span class="font-mono font-bold">{{ bucket.count }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-meta text-muted-foreground">{{ 'assets.noBuckets' | transloco }}</p>
            }
          </tk-card>

          <!-- Ordered by count, largest first: the row worth explaining — one
               person holding eleven laptops — is the first one read. -->
          <tk-card [heading]="'assets.topHolders' | transloco">
            @if (totals.topHolders.length) {
              <ul class="space-y-1.5">
                @for (holder of totals.topHolders; track holder.id) {
                  <li class="flex items-center justify-between gap-3 text-body">
                    <span class="flex min-w-0 items-center gap-1.5">
                      <tk-avatar [name]="holder.name" [size]="20" round />
                      <span class="truncate">{{ holder.name }}</span>
                    </span>
                    <span class="font-mono font-bold">{{ holder.count }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-meta text-muted-foreground">{{ 'assets.noHolders' | transloco }}</p>
            }
          </tk-card>
        </div>
      }
    }

    <tk-card dense class="mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-muted px-3">
          <tk-icon name="search" [size]="16" class="text-muted-foreground" />
          <input
            class="w-full bg-transparent text-body outline-none"
            type="search"
            [placeholder]="'assets.searchPlaceholder' | transloco"
            [attr.aria-label]="'assets.searchPlaceholder' | transloco"
            [ngModel]="search()"
            (ngModelChange)="onSearch($event)"
          />
        </div>

        <label class="flex items-center gap-2 text-meta text-muted-foreground">
          <input
            type="checkbox"
            class="size-4 accent-primary"
            [checked]="retired() === '1'"
            (change)="setParam('retired', retired() === '1' ? '' : '1')"
          />
          {{ 'assets.showRetired' | transloco }}
        </label>
      </div>
    </tk-card>

    @if (assets.error()) {
      <tk-alert tone="danger" [heading]="'assets.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="assets.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <tk-card flush>
        <div class="overflow-x-auto">
          <table tkTable hover class="min-w-[900px]">
            <thead>
              <tr>
                <th scope="col">{{ 'assets.columns.asset' | transloco }}</th>
                <th scope="col">{{ 'assets.columns.kind' | transloco }}</th>
                <th scope="col">{{ 'assets.columns.location' | transloco }}</th>
                <th scope="col">{{ 'assets.columns.holder' | transloco }}</th>
                <th scope="col" class="col-right">{{ 'assets.columns.openTickets' | transloco }}</th>
                <th scope="col" class="col-right">{{ 'assets.columns.allTickets' | transloco }}</th>
                <th scope="col">{{ 'assets.columns.lastSeen' | transloco }}</th>
              </tr>
            </thead>
            <tbody>
              @if (assets.isLoading() && !assets.value()) {
                @for (row of skeletonRows; track row) {
                  <tr><td colspan="7"><span tkSkeleton class="block h-5 w-full"></span></td></tr>
                }
              } @else {
                @for (asset of rows(); track asset.id) {
                  <tr class="cursor-pointer" (click)="inspect(asset)">
                    <td>
                      <p class="font-semibold" [class.text-muted-foreground]="!asset.isActive">
                        {{ asset.name }}
                        @if (!asset.isActive) {
                          <tk-badge tone="neutral" class="ml-1">{{ 'assets.retired' | transloco }}</tk-badge>
                        }
                      </p>
                      @if (asset.tag) {
                        <p class="font-mono text-meta text-muted-foreground">{{ asset.tag }}</p>
                      }
                    </td>
                    <td class="text-body">{{ asset.kind || '—' }}</td>
                    <td class="text-body">{{ asset.location || '—' }}</td>
                    <td>
                      @if (asset.assignedTo; as who) {
                        <span class="flex items-center gap-1.5">
                          <tk-avatar [name]="who.name || who.email" [imageUrl]="who.avatarUrl" [size]="22" round />
                          <span class="truncate text-body">{{ who.name || who.email }}</span>
                        </span>
                      } @else {
                        <span class="text-meta text-muted-foreground">{{ 'assets.onTheShelf' | transloco }}</span>
                      }
                    </td>
                    <!-- Amber only when there is something open. A zero in a
                         warning colour teaches people to ignore the colour. -->
                    <td class="col-right">
                      @if (asset.openTicketCount) {
                        <tk-badge tone="warning">{{ asset.openTicketCount }}</tk-badge>
                      } @else {
                        <span class="text-meta text-muted-foreground">0</span>
                      }
                    </td>
                    <td class="col-right font-mono text-body">{{ asset.ticketCount }}</td>
                    <td class="text-meta text-muted-foreground">
                      {{ asset.lastTicketAt ? formatted(asset.lastTicketAt) : ('assets.never' | transloco) }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="p-0">
                      <tk-empty-state
                        icon="hard-drive"
                        [heading]="(searching() ? 'assets.empty.filteredHeading' : 'assets.empty.heading') | transloco"
                        [description]="(searching() ? 'assets.empty.filteredBody' : 'assets.empty.body') | transloco"
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

    <!-- A drawer, not a route: after reading one asset's history the next move is
         usually the row below it, and a page change loses the list. -->
    <tk-drawer [(open)]="drawerOpen" [heading]="chosen()?.name ?? ''">
      @if (chosen(); as asset) {
        <dl class="mb-4 space-y-2 text-body">
          @if (asset.tag) {
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-muted-foreground">{{ 'assets.columns.tag' | transloco }}</dt>
              <dd class="font-mono font-semibold">{{ asset.tag }}</dd>
            </div>
          }
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'assets.columns.kind' | transloco }}</dt>
            <dd class="font-semibold">{{ asset.kind || '—' }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'assets.columns.location' | transloco }}</dt>
            <dd class="font-semibold">{{ asset.location || '—' }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground">{{ 'assets.columns.holder' | transloco }}</dt>
            <dd class="font-semibold">
              {{ asset.assignedTo?.name || asset.assignedTo?.email || ('assets.onTheShelf' | transloco) }}
            </dd>
          </div>
        </dl>

        @if (asset.notes) {
          <p class="mb-4 rounded-lg bg-muted p-3 text-body whitespace-pre-wrap">{{ asset.notes }}</p>
        }

        <h3 class="mb-2 text-body font-bold">{{ 'assets.history' | transloco }}</h3>

        @if (history.value(); as tickets) {
          @if (tickets.length) {
            <ul class="divide-y divide-border">
              @for (ticket of tickets; track ticket.id) {
                <li class="py-2.5">
                  <a class="block" [routerLink]="['/dashboard/tickets', ticket.id]" (click)="drawerOpen.set(false)">
                    <span class="block truncate text-body font-semibold hover:text-primary">
                      {{ ticket.subject }}
                    </span>
                    <span class="mt-1 flex flex-wrap items-center gap-1.5">
                      <span class="font-mono text-meta text-muted-foreground">#{{ number(ticket.id) }}</span>
                      <tk-badge [tone]="statusTone(ticket.statusCategory).tone" dot>
                        {{ ticket.statusName }}
                      </tk-badge>
                      <tk-badge [tone]="priorityTone(ticket.priority).tone">
                        {{ priorityTone(ticket.priority).labelKey | transloco }}
                      </tk-badge>
                      <span class="text-meta text-muted-foreground">{{ formatted(ticket.createdAt) }}</span>
                    </span>
                  </a>
                </li>
              }
            </ul>
          } @else {
            <p class="py-6 text-center text-body text-muted-foreground">
              {{ 'assets.noHistory' | transloco }}
            </p>
          }
        } @else if (history.error()) {
          <tk-alert tone="danger">{{ historyError() }}</tk-alert>
        } @else {
          <span tkSkeleton class="block h-24 w-full"></span>
        }
      }
    </tk-drawer>
  `,
})
export class AssetRegister {
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);

  /**
   * URL-bound. `q` is the search term, `retired` includes retired assets.
   *
   * `fromQuery` because clearing the search removes the param, and the router
   * then writes `undefined` rather than restoring the `''` default.
   */
  readonly q = input('', { transform: fromQuery });
  readonly retired = input('', { transform: fromQuery });

  protected readonly skeletonRows = [0, 1, 2, 3, 4];

  /** Local mirror of `q`, so typing is instant while the URL is debounced. */
  protected readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly summary = resource({ loader: () => this.api.assetSummary() });

  protected readonly assets = resource({
    params: () => ({ q: this.q(), retired: this.retired() === '1' }),
    loader: ({ params }) => this.api.assets(params.q || undefined, params.retired),
  });

  protected readonly rows = computed(() => this.assets.value() ?? []);
  protected readonly loadError = computed(() => errorMessage(this.assets.error()));
  protected readonly searching = computed(() => this.q().trim().length > 0);

  protected readonly drawerOpen = signal(false);
  protected readonly chosen = signal<Asset | null>(null);

  /**
   * The chosen asset's ticket history.
   *
   * Keyed on the asset id rather than fetched in `inspect`, so re-opening the same
   * row does not re-request and the drawer's own loading state is the resource's.
   */
  protected readonly history = resource({
    params: () => ({ id: this.chosen()?.id ?? '' }),
    loader: ({ params }) => (params.id ? this.api.assetTickets(params.id) : Promise.resolve([])),
  });

  protected readonly historyError = computed(() => errorMessage(this.history.error()));

  protected number(id: string): string {
    return id.slice(0, 8);
  }

  protected formatted(iso: string): string {
    return formatDate(iso);
  }

  /** A blank bucket is "nobody filled this in", said in words rather than left empty. */
  protected label(value: string | null): string {
    return value?.trim() ? value : '—';
  }

  protected statusTone(category: string) {
    return toneFor(STATUS_TONE, category);
  }

  protected priorityTone(priority: string) {
    return toneFor(PRIORITY_TONE, priority);
  }

  protected inspect(asset: Asset): void {
    this.chosen.set(asset);
    this.drawerOpen.set(true);
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    // Debounced, and `replaceUrl` so a search does not fill the history stack.
    this.searchTimer = setTimeout(() => this.setParam('q', value), 300);
  }

  protected setParam(key: string, value: string): void {
    void this.router.navigate([], {
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
