import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  IMPACT_TONE,
  PRIORITY_TONE,
  STATUS_TONE,
  TicketsApi,
  errorMessage,
  formatDate,
  toneFor,
  type BusinessService,
} from '@trackly/core';
import {
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
  type IconName,
} from '@trackly/ui';

/**
 * Which of the things the business runs are currently broken, and how badly.
 *
 * **This is a status board, not a list of nouns.** The service catalogue already
 * existed in admin settings as names to pick from; what nobody could answer was
 * "what is down right now" — the question that decides whose ticket gets picked up
 * first. Every number here is derived from open tickets, so it cannot drift from
 * reality: there is no separate "service status" somebody has to remember to set
 * back to green.
 *
 * **Down is not a bigger version of degraded.** Danger is reserved for a service
 * that is off, and that reservation is the whole design: on a board where
 * everything is amber, nothing is urgent. A degraded service is a problem to work
 * on; a service that is off is an incident, and only one of them should stop
 * somebody mid-scroll.
 *
 * Ordered worst-first rather than by the admin's sort order. The catalogue's order
 * is for picking from a dropdown; here, the row that matters is the row at the top.
 */
@Component({
  selector: 'tk-service-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
  ],
  template: `
    <tk-page-header
      [title]="'services.title' | transloco"
      [subtitle]="'services.subtitle' | transloco"
    />

    <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <tk-stat-card
        [label]="'services.stats.down' | transloco"
        icon="octagon-alert"
        tone="danger"
        [value]="counts()?.down"
      />
      <tk-stat-card
        [label]="'services.stats.degraded' | transloco"
        icon="activity"
        tone="warning"
        [value]="counts()?.degraded"
      />
      <tk-stat-card
        [label]="'services.stats.healthy' | transloco"
        icon="check-circle"
        tone="success"
        [value]="counts()?.healthy"
      />
      <tk-stat-card
        [label]="'services.stats.total' | transloco"
        icon="server"
        tone="neutral"
        [value]="counts()?.total"
      />
    </div>

    @if (services.error()) {
      <tk-alert tone="danger" [heading]="'services.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="services.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else if (services.isLoading() && !services.value()) {
      <div class="grid gap-3 md:grid-cols-2">
        @for (row of skeletonRows; track row) {
          <span tkSkeleton class="block h-24 w-full rounded-xl"></span>
        }
      </div>
    } @else if (rows().length) {
      <!-- Cards rather than table rows. A service's state is one badge and one
           number, which a table spaces out across 900px of mostly-empty columns;
           as a card it reads at a glance, which is what a board is for. -->
      <div class="grid gap-3 md:grid-cols-2">
        @for (service of rows(); track service.id) {
          <button
            type="button"
            class="rounded-xl border p-4 text-left transition-colors"
            [class]="frameClass(service)"
            (click)="inspect(service)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="flex items-center gap-1.5 text-body font-bold">
                  <tk-icon [name]="icon(service)" [size]="15" class="shrink-0" [class]="accentClass(service)" />
                  <span class="truncate">{{ service.name }}</span>
                </p>
                @if (service.description) {
                  <p class="mt-0.5 line-clamp-2 text-meta text-muted-foreground">{{ service.description }}</p>
                }
              </div>

              @if (service.worstLevel; as level) {
                <tk-badge [tone]="impactTone(level).tone">{{ impactTone(level).labelKey | transloco }}</tk-badge>
              } @else {
                <tk-badge tone="success" dot>{{ 'services.operational' | transloco }}</tk-badge>
              }
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
              @if (service.openTicketCount) {
                <span class="font-semibold">
                  {{ 'services.openTickets' | transloco: { count: service.openTicketCount } }}
                </span>
              } @else {
                <span class="text-muted-foreground">{{ 'services.noOpenTickets' | transloco }}</span>
              }
              @if (service.ownerTeamName) {
                <span class="text-muted-foreground">
                  {{ 'services.ownedBy' | transloco: { team: service.ownerTeamName } }}
                </span>
              }
            </div>
          </button>
        }
      </div>
    } @else {
      <!-- No catalogue at all is a setup gap, not an outage. The copy says where
           to go rather than reporting an absence. -->
      <tk-card>
        <tk-empty-state
          icon="server"
          [heading]="'services.empty.heading' | transloco"
          [description]="'services.empty.body' | transloco"
        />
      </tk-card>
    }

    <tk-drawer [(open)]="drawerOpen" [heading]="chosen()?.name ?? ''">
      @if (chosen(); as service) {
        @if (service.description) {
          <p class="mb-3 text-body text-muted-foreground">{{ service.description }}</p>
        }

        <div class="mb-4 flex flex-wrap items-center gap-2">
          @if (service.worstLevel; as level) {
            <tk-badge [tone]="impactTone(level).tone">{{ impactTone(level).labelKey | transloco }}</tk-badge>
          } @else {
            <tk-badge tone="success" dot>{{ 'services.operational' | transloco }}</tk-badge>
          }
          @if (service.ownerTeamName) {
            <span class="text-meta text-muted-foreground">
              {{ 'services.ownedBy' | transloco: { team: service.ownerTeamName } }}
            </span>
          }
        </div>

        <h3 class="mb-2 text-body font-bold">{{ 'services.reportedBy' | transloco }}</h3>

        @if (tickets.value(); as list) {
          @if (list.length) {
            <ul class="divide-y divide-border">
              @for (ticket of list; track ticket.id) {
                <li class="py-2.5">
                  <a class="block" [routerLink]="['/dashboard/tickets', ticket.id]" (click)="drawerOpen.set(false)">
                    <span class="flex items-start gap-2">
                      <tk-badge [tone]="impactTone(ticket.level).tone" class="mt-0.5 shrink-0">
                        {{ impactTone(ticket.level).labelKey | transloco }}
                      </tk-badge>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-body font-semibold hover:text-primary">
                          {{ ticket.subject }}
                        </span>
                        <!-- The agent's own words about the impact, when they wrote
                             any. This is the sentence that turns "degraded" into
                             something actionable. -->
                        @if (ticket.impact) {
                          <span class="block text-meta text-muted-foreground">{{ ticket.impact }}</span>
                        }
                        <span class="mt-1 flex flex-wrap items-center gap-1.5">
                          <span class="font-mono text-meta text-muted-foreground">#{{ number(ticket.id) }}</span>
                          <tk-badge [tone]="statusTone(ticket.statusCategory).tone" dot>
                            {{ ticket.statusName }}
                          </tk-badge>
                          <tk-badge [tone]="priorityTone(ticket.priority).tone">
                            {{ priorityTone(ticket.priority).labelKey | transloco }}
                          </tk-badge>
                          @if (ticket.assignee; as who) {
                            <span class="flex items-center gap-1">
                              <tk-avatar [name]="who.name || who.email" [imageUrl]="who.avatarUrl" [size]="18" round />
                              <span class="text-meta text-muted-foreground">{{ who.name || who.email }}</span>
                            </span>
                          }
                          <span class="text-meta text-muted-foreground">{{ formatted(ticket.addedAt) }}</span>
                        </span>
                      </span>
                    </span>
                  </a>
                </li>
              }
            </ul>
          } @else {
            <p class="py-6 text-center text-body text-muted-foreground">
              {{ 'services.noReports' | transloco }}
            </p>
          }
        } @else if (tickets.error()) {
          <tk-alert tone="danger">{{ ticketsError() }}</tk-alert>
        } @else {
          <span tkSkeleton class="block h-24 w-full"></span>
        }
      }
    </tk-drawer>
  `,
})
export class ServiceBoard {
  private readonly api = inject(TicketsApi);

  protected readonly skeletonRows = [0, 1, 2, 3];

  protected readonly services = resource({ loader: () => this.api.services() });

  /**
   * Worst first, then by how many people are reporting it, then by name.
   *
   * The admin's `sortOrder` is deliberately ignored: that order exists so a
   * dropdown reads sensibly, and a board sorted by it buries the outage under
   * whatever happens to be alphabetically first.
   */
  protected readonly rows = computed(() =>
    [...(this.services.value() ?? [])].sort(
      (a, b) =>
        RANK[a.worstLevel ?? 'ok'] - RANK[b.worstLevel ?? 'ok'] ||
        b.openTicketCount - a.openTicketCount ||
        a.name.localeCompare(b.name),
    ),
  );

  protected readonly loadError = computed(() => errorMessage(this.services.error()));

  /**
   * The headline numbers.
   *
   * Undefined until the list has loaded, so the stat cards render `—` rather than
   * a confident `0 down` that is only true because nothing has arrived yet.
   */
  protected readonly counts = computed(() => {
    const list = this.services.value();
    if (!list) return undefined;
    return {
      total: list.length,
      down: list.filter((s) => s.worstLevel === 'down').length,
      // Everything affected but not off — degraded and minor together, because
      // the distinction between those two matters on the row and not in a KPI.
      degraded: list.filter((s) => s.worstLevel && s.worstLevel !== 'down').length,
      healthy: list.filter((s) => !s.worstLevel).length,
    };
  });

  protected readonly drawerOpen = signal(false);
  protected readonly chosen = signal<BusinessService | null>(null);

  protected readonly tickets = resource({
    params: () => ({ id: this.chosen()?.id ?? '' }),
    loader: ({ params }) => (params.id ? this.api.serviceTickets(params.id) : Promise.resolve([])),
  });

  protected readonly ticketsError = computed(() => errorMessage(this.tickets.error()));

  protected number(id: string): string {
    return id.slice(0, 8);
  }

  protected formatted(iso: string): string {
    return formatDate(iso);
  }

  protected impactTone(level: string) {
    return toneFor(IMPACT_TONE, level);
  }

  protected statusTone(category: string) {
    return toneFor(STATUS_TONE, category);
  }

  protected priorityTone(priority: string) {
    return toneFor(PRIORITY_TONE, priority);
  }

  /** Static class strings — an interpolated Tailwind class emits no CSS under v4. */
  protected frameClass(service: BusinessService): string {
    if (service.worstLevel === 'down') return 'border-danger/50 bg-danger/5 hover:bg-danger/10';
    if (service.worstLevel) return 'border-warning/50 bg-warning/5 hover:bg-warning/10';
    return 'border-border bg-card hover:bg-accent';
  }

  protected accentClass(service: BusinessService): string {
    if (service.worstLevel === 'down') return 'text-danger';
    if (service.worstLevel) return 'text-warning-ink';
    return 'text-muted-foreground';
  }

  protected icon(service: BusinessService): IconName {
    return service.worstLevel === 'down' ? 'octagon-alert' : 'server';
  }

  /**
   * Opens the drawer for any service, healthy ones included.
   *
   * A healthy service's drawer is not empty and wrong — it is the answer "nothing
   * is reporting this", which is worth being able to confirm. Refusing to open it
   * would make the one row you most want to double-check the only unclickable one.
   */
  protected inspect(service: BusinessService): void {
    this.chosen.set(service);
    this.drawerOpen.set(true);
  }
}

/** Worst → best. `ok` is the sentinel for "no open ticket says anything is wrong". */
const RANK: Record<string, number> = { down: 0, degraded: 1, minor: 2, ok: 3 };
