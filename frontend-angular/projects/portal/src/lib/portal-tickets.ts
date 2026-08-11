import { ChangeDetectionStrategy, Component, computed, inject, input, resource } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  settled,
    STATUS_TONE,
  TicketsApi,
  errorMessage,
  fromQueryOr,
  timeAgo,
  toneFor,
  type TicketSummary,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  SkeletonDirective,
  Tabs,
  type TabItem,
} from '@trackly/ui';

/** The fixed status categories, split the way a customer thinks about them. */
const LIVE = ['open', 'pending', 'active'];

/** How many tickets one request brings back. See `truncated` below. */
const PAGE_SIZE = 100;

/**
 * A customer's own tickets.
 *
 * The API scopes the list to the caller, so there is no requester filter here —
 * asking for someone else's tickets is not a request this screen can make.
 *
 * The tab lives in the URL (`?view=open`), which is what makes "here is the one
 * I mean" a link somebody can paste into an email, and makes Back work between
 * the tabs and a ticket.
 */
@Component({
  selector: 'tk-portal-tickets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    SkeletonDirective,
    Tabs,
  ],
  template: `
    <tk-page-header [title]="'portal.tickets.title' | transloco">
      <a tkButton page-actions routerLink="/portal/tickets/new">
        <tk-icon name="plus" [size]="16" />
        {{ 'portal.newTicket' | transloco }}
      </a>
    </tk-page-header>

    <tk-tabs class="mb-4" [tabs]="tabs()" [active]="view()" (activeChange)="setView($event)" panelId="portal-tickets" />

    <div id="portal-tickets" role="region" [attr.aria-label]="'portal.tickets.title' | transloco">
      @if (loadedTickets()) {
        @if (truncated()) {
          <p class="mb-3 text-meta text-muted-foreground">
            {{ 'portal.tickets.truncated' | transloco: { shown: loaded(), total: total() } }}
          </p>
        }

        <div class="space-y-3">
          @for (ticket of rows(); track ticket.id) {
            <a class="block" [class.opacity-70]="done(ticket)" [routerLink]="['/portal/tickets', ticket.id]">
              <tk-card interactive>
                <div class="flex items-center gap-4">
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-body font-semibold">
                      <span class="font-mono text-muted-foreground">#{{ number(ticket) }}</span>
                      {{ ticket.subject }}
                    </span>
                    <span class="mt-1 block truncate text-meta text-muted-foreground">
                      @if (ticket.category; as category) {
                        {{ category.name }} ·
                      }
                      {{ 'portal.tickets.updated' | transloco: { time: age(ticket) } }}
                      @if (ticket.commentCount > 0) {
                        ·
                        {{
                          (ticket.commentCount === 1 ? 'portal.tickets.replyOne' : 'portal.tickets.replies')
                            | transloco: { count: ticket.commentCount }
                        }}
                      }
                    </span>
                  </span>
                  @let tone = statusTone(ticket);
                  <tk-badge [tone]="tone.tone" dot>{{ ticket.statusName || (tone.labelKey | transloco) }}</tk-badge>
                </div>
              </tk-card>
            </a>
          } @empty {
            <!-- Two different empties: a customer with no tickets at all is being
                 invited to raise one, while an empty tab just means look in
                 another tab. Offering "raise a ticket" for the second is how
                 somebody ends up filing a duplicate of the one they were after. -->
            <tk-empty-state
              icon="ticket"
              [heading]="(anyTickets() ? 'portal.tickets.emptyTab' : 'portal.tickets.empty') | transloco"
              [description]="(anyTickets() ? 'portal.tickets.emptyTabBody' : 'portal.tickets.emptyBody') | transloco"
            />
          }
        </div>
      } @else if (tickets.error()) {
        <tk-alert tone="danger" [heading]="'portal.tickets.loadFailed' | transloco">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="tickets.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <div class="space-y-3">
          @for (row of skeletonRows; track row) {
            <span tkSkeleton class="block h-[74px] w-full rounded-xl"></span>
          }
        </div>
      }
    </div>
  `,
})
export class PortalTickets {
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  /**
   * `fromQueryOr` rather than a bare default: the router writes `undefined` when
   * the param leaves the URL, and an undefined view would read as "no filter"
   * while the rail still highlighted Open.
   */
  readonly view = input('open', { transform: fromQueryOr('open') });

  protected readonly skeletonRows = [0, 1, 2];

  protected readonly tickets = resource({
    loader: () => this.api.list({ pageSize: PAGE_SIZE }),
  });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedTickets = settled(() => this.tickets);

  private readonly all = computed(() => this.loadedTickets()?.items ?? []);
  protected readonly anyTickets = computed(() => this.all().length > 0);
  protected readonly loaded = computed(() => this.all().length);
  protected readonly total = computed(() => this.loadedTickets()?.total ?? 0);

  /**
   * One page is all a portal fetches, so say so when there is more.
   *
   * A customer with more than a hundred tickets is rare; a screen that quietly
   * showed a hundred of two hundred and called it "All" would be wrong every
   * time it happened.
   */
  protected readonly truncated = computed(() => this.total() > this.loaded());

  private readonly live = computed(() => this.all().filter((ticket) => !this.done(ticket)));
  private readonly closed = computed(() => this.all().filter((ticket) => this.done(ticket)));

  protected readonly rows = computed(() => {
    switch (this.view()) {
      case 'resolved':
        return this.closed();
      case 'all':
        return this.all();
      default:
        return this.live();
    }
  });

  protected readonly tabs = computed<readonly TabItem[]>(() => {
    this.lang();
    return [
      { id: 'open', label: this.transloco.translate('portal.tickets.tabs.open'), count: this.live().length },
      { id: 'resolved', label: this.transloco.translate('portal.tickets.tabs.resolved'), count: this.closed().length },
      { id: 'all', label: this.transloco.translate('portal.tickets.tabs.all'), count: this.all().length },
    ];
  });

  protected readonly loadError = computed(() => errorMessage(this.tickets.error()));

  /** Badge by CATEGORY — the status name itself is workspace vocabulary. */
  protected statusTone(ticket: TicketSummary) {
    return toneFor(STATUS_TONE, ticket.statusCategory);
  }

  protected done(ticket: TicketSummary): boolean {
    return !LIVE.includes(ticket.statusCategory);
  }

  protected age(ticket: TicketSummary): string {
    return timeAgo(ticket.updatedAt);
  }

  /** Ids are GUIDs; the first block is short enough to read out on a call. */
  protected number(ticket: TicketSummary): string {
    return ticket.id.slice(0, 8);
  }

  /** `replaceUrl` so switching tabs does not fill the Back stack. */
  protected setView(view: string): void {
    void this.router.navigate([], {
      queryParams: { view: view === 'open' ? null : view },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
