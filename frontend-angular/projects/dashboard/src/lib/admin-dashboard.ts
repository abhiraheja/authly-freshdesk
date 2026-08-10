import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  AnalyticsApi,
  IMPACT_TONE,
  PRIORITY_TONE,
  STATUS_TONE,
  errorMessage,
  timeAgo,
  toneFor,
  type AgentLeaderRow,
  type ServiceTroubleRow,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Bars,
  Card,
  Icon,
  Select,
  SelectOption,
  SkeletonDirective,
  StatCard,
  type BarGroup,
  TableDirective,
} from '@trackly/ui';

/**
 * The whole desk, for whoever runs it.
 *
 * **Two halves, and the split is the design.** Everything above the volume chart is
 * *right now* — what is unassigned, what is overdue, what is off. Everything below
 * is a *trailing window* — whether the team is keeping up. An admin has exactly one
 * of each question, and putting them on separate screens is how nobody ever reads
 * them together.
 *
 * **Nothing is hidden, and nothing is invented.** Every number comes from
 * `GET /api/dashboard/analytics`. Where the workspace has never configured
 * something — no reward goals, no service catalogue — the card says so and points
 * at where to set it up, rather than rendering an empty chart that reads as "zero".
 *
 * Admin-only: the leaderboard carries every agent's response times and CSAT, which
 * is management information. The route guard is the navigation story; the endpoint
 * is the rule.
 */
@Component({
  selector: 'tk-admin-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    Alert,
    Avatar,
    Badge,
    Bars,
    Card,
    Icon,
    Select,
    SelectOption,
    SkeletonDirective,
    StatCard,
    TableDirective,
  ],
  template: `
    @if (overview.error()) {
      <tk-alert tone="danger" [heading]="'dashboard.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="overview.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <div class="space-y-6">
        <!-- ── Right now ────────────────────────────────────────────────────
             Ordered by what it costs to miss. Unassigned and overdue lead
             because they are the two that get worse on their own. -->
        <section>
          <h2 class="mb-3 font-display text-section font-extrabold">
            {{ 'dashboard.admin.rightNow' | transloco }}
          </h2>
          <div class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <tk-stat-card
              [label]="'dashboard.admin.open' | transloco"
              icon="folder-open"
              tone="primary"
              [value]="data()?.openNow"
              clickable
              routerLink="/dashboard/tickets"
              [queryParams]="{ view: 'active' }"
            />
            <tk-stat-card
              [label]="'dashboard.admin.unassigned' | transloco"
              icon="user-x"
              [tone]="(data()?.unassignedNow ?? 0) > 0 ? 'danger' : 'success'"
              [value]="data()?.unassignedNow"
            />
            <tk-stat-card
              [label]="'dashboard.admin.overdue' | transloco"
              icon="timer"
              [tone]="(data()?.overdueNow ?? 0) > 0 ? 'danger' : 'success'"
              [value]="data()?.overdueNow"
            />
            <tk-stat-card
              [label]="'dashboard.admin.awaitingReply' | transloco"
              icon="message-square"
              [tone]="(data()?.awaitingFirstReply ?? 0) > 0 ? 'warning' : 'success'"
              [value]="data()?.awaitingFirstReply"
            />
            <tk-stat-card
              [label]="'dashboard.admin.openTasks' | transloco"
              icon="clipboard-list"
              [tone]="(data()?.overdueTasks ?? 0) > 0 ? 'warning' : 'info'"
              [value]="data()?.openTasks"
              clickable
              routerLink="/dashboard/tasks"
              [queryParams]="{ assignee: 'all' }"
            />
            <tk-stat-card
              [label]="'dashboard.admin.servicesDown' | transloco"
              icon="octagon-alert"
              [tone]="downCount() > 0 ? 'danger' : 'success'"
              [value]="servicesLoaded() ? downCount() : undefined"
              clickable
              routerLink="/dashboard/services"
            />
          </div>
        </section>

        <!-- Services in trouble, with how long. The "since" is the whole point:
             a red row says something is wrong, and "down 3d" says somebody has
             stopped noticing. -->
        @if (services().length) {
          <tk-card [heading]="'dashboard.admin.servicesInTrouble' | transloco">
            <div card-actions>
              <a class="text-meta font-semibold text-primary hover:underline" routerLink="/dashboard/services">
                {{ 'dashboard.admin.viewBoard' | transloco }}
              </a>
            </div>
            <ul class="divide-y divide-border">
              @for (service of services(); track service.serviceId) {
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <tk-badge [tone]="impactTone(service.level).tone">
                    {{ impactTone(service.level).labelKey | transloco }}
                  </tk-badge>
                  <span class="min-w-0 flex-1 truncate text-body font-semibold">{{ service.name }}</span>
                  @if (service.ownerTeamName) {
                    <span class="text-meta text-muted-foreground">{{ service.ownerTeamName }}</span>
                  }
                  <span class="text-meta text-muted-foreground">
                    {{ 'dashboard.admin.reportedBy' | transloco: { count: service.openTicketCount } }}
                  </span>
                  <!-- Amber past a day, because "down since this morning" and
                       "down since Tuesday" are different conversations. -->
                  <span class="text-meta font-semibold" [class]="sinceClass(service)">
                    {{ 'dashboard.admin.since' | transloco: { age: since(service) } }}
                  </span>
                </li>
              }
            </ul>
          </tk-card>
        }

        <!-- ── The window ───────────────────────────────────────────────────── -->
        <section>
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-display text-section font-extrabold">
              {{ 'dashboard.admin.trend' | transloco }}
            </h2>
            <tk-select
              auto
              size="sm"
              [ariaLabel]="'dashboard.admin.window' | transloco"
              [value]="days()"
              (valueChange)="days.set($event)"
            >
              <tk-option value="7" [label]="'dashboard.admin.days7' | transloco" />
              <tk-option value="30" [label]="'dashboard.admin.days30' | transloco" />
              <tk-option value="90" [label]="'dashboard.admin.days90' | transloco" />
            </tk-select>
          </div>

          <div class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <tk-stat-card
              [label]="'dashboard.admin.created' | transloco"
              icon="inbox"
              tone="info"
              [value]="data()?.createdInWindow"
            />
            <tk-stat-card
              [label]="'dashboard.admin.resolved' | transloco"
              icon="check-circle"
              tone="success"
              [value]="data()?.resolvedInWindow"
            />
            <tk-stat-card
              [label]="'dashboard.admin.firstResponse' | transloco"
              icon="clock"
              tone="neutral"
              [value]="durationOrUndefined(data()?.avgFirstResponseMinutes)"
              invert
            />
            <tk-stat-card
              [label]="'dashboard.admin.resolutionTime' | transloco"
              icon="timer"
              tone="neutral"
              [value]="durationOrUndefined(data()?.avgResolutionMinutes)"
              invert
            />
            <tk-stat-card
              [label]="'dashboard.admin.slaAttainment' | transloco"
              icon="shield-check"
              [tone]="slaTone()"
              [value]="percentOrUndefined(data()?.resolutionSlaAttainment)"
            />
            <tk-stat-card
              [label]="'dashboard.admin.csat' | transloco"
              icon="smile"
              tone="primary"
              [value]="csatValue()"
            />
          </div>
        </section>

        <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <tk-card class="xl:col-span-2" [heading]="'dashboard.admin.volume' | transloco">
            @if (overview.isLoading() && !data()) {
              <span tkSkeleton class="block h-32 w-full"></span>
            } @else if (data()?.createdInWindow) {
              <tk-bars [data]="volumeBars()" [seriesNames]="['Created']" />
            } @else {
              <p class="py-10 text-center text-body text-muted-foreground">
                {{ 'dashboard.admin.noVolume' | transloco }}
              </p>
            }
          </tk-card>

          <!-- How long the open queue has been waiting. Buckets, not an average:
               twenty tickets from this morning and one from March average out to
               something reassuring, and the one from March is the only row that
               matters. -->
          <tk-card [heading]="'dashboard.admin.aging' | transloco">
            <div card-actions>
              @if (data()?.oldestOpenDays; as oldest) {
                <span class="text-meta font-bold text-warning-ink">
                  {{ 'dashboard.admin.oldest' | transloco: { days: oldest } }}
                </span>
              }
            </div>
            @if (overview.isLoading() && !data()) {
              <span tkSkeleton class="block h-32 w-full"></span>
            } @else {
              <ul class="space-y-2.5">
                @for (bucket of data()?.aging ?? []; track bucket.label) {
                  <li class="flex items-center justify-between gap-3 text-body">
                    <span class="text-muted-foreground">
                      {{ 'dashboard.admin.ageBuckets.' + bucket.label | transloco }}
                    </span>
                    <b class="font-display font-extrabold" [class.text-danger]="isOld(bucket.label) && bucket.count > 0">
                      {{ bucket.count }}
                    </b>
                  </li>
                }
              </ul>
            }
          </tk-card>
        </div>

        <!-- ── Who is doing what ───────────────────────────────────────────── -->
        <tk-card flush [heading]="'dashboard.admin.agents' | transloco">
          <div card-actions>
            <span class="text-meta text-muted-foreground">
              {{ 'dashboard.admin.agentsHint' | transloco }}
            </span>
          </div>
          <div class="overflow-x-auto">
            <table tkTable hover class="min-w-[980px]">
              <thead>
                <tr>
                  <th scope="col">{{ 'dashboard.admin.columns.agent' | transloco }}</th>
                  <th scope="col" class="text-right">{{ 'dashboard.admin.columns.resolved' | transloco }}</th>
                  <th scope="col" class="text-right">{{ 'dashboard.admin.columns.open' | transloco }}</th>
                  <th scope="col" class="text-right">{{ 'dashboard.admin.columns.overdue' | transloco }}</th>
                  <th scope="col" class="text-right">{{ 'dashboard.admin.columns.tasks' | transloco }}</th>
                  <th scope="col" class="text-right">{{ 'dashboard.admin.columns.firstResponse' | transloco }}</th>
                  <th scope="col" class="text-right">{{ 'dashboard.admin.columns.sla' | transloco }}</th>
                  <th scope="col" class="text-right">{{ 'dashboard.admin.columns.csat' | transloco }}</th>
                  <th scope="col" class="text-right">{{ 'dashboard.admin.columns.points' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @if (overview.isLoading() && !data()) {
                  @for (row of skeletonRows; track row) {
                    <tr><td colspan="9"><span tkSkeleton class="block h-5 w-full"></span></td></tr>
                  }
                } @else {
                  @for (row of leaderboard(); track row.agent.id) {
                    <tr>
                      <td>
                        <span class="flex items-center gap-2">
                          <tk-avatar
                            [name]="row.agent.name || row.agent.email"
                            [imageUrl]="row.agent.avatarUrl"
                            [size]="26"
                            round
                          />
                          <span class="min-w-0">
                            <span class="block truncate font-semibold">
                              {{ row.agent.name || row.agent.email }}
                            </span>
                            @if (row.badges) {
                              <span class="flex items-center gap-1 text-meta text-muted-foreground">
                                <tk-icon name="trophy" [size]="11" class="text-warning-ink" />
                                {{ 'dashboard.admin.badgeCount' | transloco: { count: row.badges } }}
                              </span>
                            }
                          </span>
                        </span>
                      </td>
                      <td class="text-right font-mono">{{ row.resolved }}</td>
                      <td class="text-right font-mono">{{ row.openNow }}</td>
                      <td class="text-right">
                        @if (row.overdueNow) {
                          <tk-badge tone="danger">{{ row.overdueNow }}</tk-badge>
                        } @else {
                          <span class="font-mono text-muted-foreground">0</span>
                        }
                      </td>
                      <td class="text-right font-mono">{{ row.pendingTasks }}</td>
                      <td class="text-right font-mono">{{ duration(row.avgFirstResponseMinutes) }}</td>
                      <td class="text-right font-mono" [class]="attainmentClass(row)">
                        {{ percent(row.resolutionSlaAttainment) }}
                      </td>
                      <td class="text-right font-mono">{{ row.avgCsat ?? '—' }}</td>
                      <td class="text-right font-mono">{{ row.rewardPoints }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="9" class="py-8 text-center text-body text-muted-foreground">
                        {{ 'dashboard.admin.noAgents' | transloco }}
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </tk-card>

        <!-- ── Breakdowns ─────────────────────────────────────────────────── -->
        <div class="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <tk-card [heading]="'dashboard.admin.byPriority' | transloco">
            <ul class="space-y-2">
              @for (row of data()?.byPriority ?? []; track row.label) {
                <li class="flex items-center justify-between gap-3">
                  <tk-badge [tone]="priorityTone(row.label).tone">
                    {{ priorityTone(row.label).labelKey | transloco }}
                  </tk-badge>
                  <b class="font-display font-extrabold">{{ row.count }}</b>
                </li>
              } @empty {
                <li class="text-meta text-muted-foreground">{{ 'dashboard.admin.nothingOpen' | transloco }}</li>
              }
            </ul>
          </tk-card>

          <tk-card [heading]="'dashboard.admin.byTeam' | transloco">
            <ul class="space-y-2">
              @for (row of data()?.byTeam ?? []; track row.label) {
                <li class="flex items-center justify-between gap-3 text-body">
                  <!-- The blank bucket is "not routed anywhere", which is the row
                       that most needs acting on. Named, never dropped. -->
                  <span class="min-w-0 truncate" [class.text-warning-ink]="!row.label">
                    {{ row.label || ('dashboard.admin.noTeam' | transloco) }}
                  </span>
                  <b class="font-display font-extrabold">{{ row.count }}</b>
                </li>
              } @empty {
                <li class="text-meta text-muted-foreground">{{ 'dashboard.admin.nothingOpen' | transloco }}</li>
              }
            </ul>
          </tk-card>

          <tk-card [heading]="'dashboard.admin.byChannel' | transloco">
            <ul class="space-y-2">
              @for (row of data()?.byChannel ?? []; track row.label) {
                <li class="flex items-center justify-between gap-3 text-body">
                  <span class="min-w-0 truncate">{{ row.label }}</span>
                  <b class="font-display font-extrabold">{{ row.count }}</b>
                </li>
              } @empty {
                <li class="text-meta text-muted-foreground">{{ 'dashboard.admin.noneInWindow' | transloco }}</li>
              }
            </ul>
          </tk-card>

          <tk-card [heading]="'dashboard.admin.byStatus' | transloco">
            <ul class="space-y-2">
              @for (row of data()?.byStatus ?? []; track row.label) {
                <li class="flex items-center justify-between gap-3 text-body">
                  <span class="min-w-0 truncate">{{ row.label }}</span>
                  <b class="font-display font-extrabold">{{ row.count }}</b>
                </li>
              } @empty {
                <li class="text-meta text-muted-foreground">{{ 'dashboard.admin.noneInWindow' | transloco }}</li>
              }
            </ul>
          </tk-card>
        </div>

        <!-- ── Recent badges ──────────────────────────────────────────────── -->
        <tk-card [heading]="'dashboard.admin.recentBadges' | transloco">
          <div card-actions>
            <a class="text-meta font-semibold text-primary hover:underline" routerLink="/admin/settings/rewards">
              {{ 'dashboard.admin.manageGoals' | transloco }}
            </a>
          </div>
          @if (awards.value(); as list) {
            @if (list.length) {
              <ul class="divide-y divide-border">
                @for (award of list; track award.id) {
                  <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <tk-icon name="trophy" [size]="14" [class]="tierClass(award.tier)" />
                    <span class="text-body font-semibold">{{ award.goalName }}</span>
                    <span class="flex items-center gap-1.5">
                      <tk-avatar
                        [name]="award.agent.name || award.agent.email"
                        [imageUrl]="award.agent.avatarUrl"
                        [size]="20"
                        round
                      />
                      <span class="text-meta">{{ award.agent.name || award.agent.email }}</span>
                    </span>
                    <span class="text-meta text-muted-foreground">{{ award.periodKey }}</span>
                    <span class="ml-auto text-meta text-muted-foreground">
                      {{ 'dashboard.admin.pointsEarned' | transloco: { points: award.points } }}
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <!-- Says where to go. An empty scoreboard with no explanation reads
                   as "nobody has achieved anything", which is not what it means
                   when no goals exist yet. -->
              <p class="py-6 text-center text-body text-muted-foreground">
                {{ 'dashboard.admin.noBadges' | transloco }}
              </p>
            }
          } @else {
            <span tkSkeleton class="block h-16 w-full"></span>
          }
        </tk-card>
      </div>
    }
  `,
})
export class AdminDashboard {
  private readonly api = inject(AnalyticsApi);

  protected readonly skeletonRows = [0, 1, 2, 3];

  /**
   * The trailing window, as a string because that is what `tk-select` emits.
   *
   * Local state rather than a URL param: this screen is the landing page, and a
   * query string on `/dashboard` would make every "go home" link carry somebody
   * else's choice of window.
   */
  protected readonly days = signal('30');

  protected readonly overview = resource({
    params: () => ({ days: Number(this.days()) || 30 }),
    loader: ({ params }) => this.api.overview(params.days),
  });

  protected readonly awards = resource({ loader: () => this.api.awards(undefined, 12) });

  protected readonly data = computed(() => this.overview.value());
  protected readonly loadError = computed(() => errorMessage(this.overview.error()));

  protected readonly leaderboard = computed(() => this.data()?.leaderboard ?? []);
  protected readonly services = computed(() => this.data()?.servicesInTrouble ?? []);
  protected readonly servicesLoaded = computed(() => this.data() !== undefined);
  protected readonly downCount = computed(
    () => this.services().filter((s) => s.level === 'down').length,
  );

  protected impactTone(level: string) {
    return toneFor(IMPACT_TONE, level);
  }

  protected priorityTone(priority: string) {
    return toneFor(PRIORITY_TONE, priority);
  }

  protected statusTone(category: string) {
    return toneFor(STATUS_TONE, category);
  }

  protected since(service: ServiceTroubleRow): string {
    return timeAgo(service.since);
  }

  /** Amber past a day: "since this morning" and "since Tuesday" are different problems. */
  protected sinceClass(service: ServiceTroubleRow): string {
    const hours = (Date.now() - new Date(service.since).getTime()) / 3_600_000;
    return hours >= 24 ? 'text-danger' : 'text-muted-foreground';
  }

  protected readonly volumeBars = computed<BarGroup[]>(() =>
    (this.data()?.volume ?? []).map((point) => ({
      label: point.date.slice(-2),
      values: [point.count],
    })),
  );

  /** The two oldest buckets are the ones worth colouring. */
  protected isOld(label: string): boolean {
    return label === '8-30d' || label === '30d+';
  }

  /**
   * Minutes as something a person reads. `undefined` rather than a string for the
   * stat card, which renders `—` for it — a made-up `0m` would read as real.
   */
  protected durationOrUndefined(minutes: number | null | undefined): string | undefined {
    return minutes === null || minutes === undefined ? undefined : this.duration(minutes);
  }

  protected duration(minutes: number | null | undefined): string {
    if (minutes === null || minutes === undefined) return '—';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }

  protected percent(fraction: number | null | undefined): string {
    return fraction === null || fraction === undefined ? '—' : `${Math.round(fraction * 100)}%`;
  }

  protected percentOrUndefined(fraction: number | null | undefined): string | undefined {
    return fraction === null || fraction === undefined ? undefined : this.percent(fraction);
  }

  /** Green at 95%+, amber from 80%, red below. Neutral when nothing was measurable. */
  protected readonly slaTone = computed(() => {
    const value = this.data()?.resolutionSlaAttainment;
    if (value === null || value === undefined) return 'neutral' as const;
    if (value >= 0.95) return 'success' as const;
    return value >= 0.8 ? ('warning' as const) : ('danger' as const);
  });

  protected readonly csatValue = computed(() => {
    const csat = this.data()?.avgCsat;
    return csat === null || csat === undefined ? undefined : `${csat} / 5`;
  });

  /** Red below 80% so a leaderboard sorted by volume cannot hide somebody missing deadlines. */
  protected attainmentClass(row: AgentLeaderRow): string {
    const value = row.resolutionSlaAttainment;
    if (value === null || value === undefined) return 'text-muted-foreground';
    if (value >= 0.95) return 'text-success';
    return value >= 0.8 ? 'text-warning-ink' : 'text-danger';
  }

  protected tierClass(tier: string): string {
    switch (tier) {
      case 'gold':
        return 'text-warning-ink';
      case 'silver':
        return 'text-muted-foreground';
      default:
        return 'text-primary';
    }
  }
}
