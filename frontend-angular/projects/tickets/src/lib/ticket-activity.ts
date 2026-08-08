import { ChangeDetectionStrategy, Component, computed, inject, input, resource } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TicketsApi, errorMessage, formatDateTime, valueOr, type TicketActivity } from '@trackly/core';
import { Alert, Avatar, Icon, SkeletonDirective, type IconName } from '@trackly/ui';

/**
 * How each kind of entry is drawn. One lookup, not a chain of `@if`s, and
 * **static strings** — an interpolated Tailwind class emits no CSS at all.
 *
 * `pair` says the entry has a before and an after worth showing side by side.
 * An assignment reads as "Unassigned → Priya"; a reply has nothing to compare
 * and would just render an arrow pointing at nothing.
 */
const SHAPES: Record<string, { icon: IconName; tint: string; pair: boolean }> = {
  created: { icon: 'plus', tint: 'text-primary', pair: false },
  status: { icon: 'refresh-cw', tint: 'text-primary', pair: true },
  priority: { icon: 'alert-circle', tint: 'text-warning-ink', pair: true },
  assignee: { icon: 'user-check', tint: 'text-muted-foreground', pair: true },
  team: { icon: 'users', tint: 'text-muted-foreground', pair: true },
  category: { icon: 'tag', tint: 'text-muted-foreground', pair: true },
  subject: { icon: 'file-text', tint: 'text-muted-foreground', pair: true },
  requester: { icon: 'user-round', tint: 'text-muted-foreground', pair: true },
  watcher_added: { icon: 'eye', tint: 'text-muted-foreground', pair: false },
  watcher_removed: { icon: 'eye', tint: 'text-muted-foreground', pair: false },
  replied: { icon: 'message-square', tint: 'text-primary', pair: false },
  noted: { icon: 'lock', tint: 'text-muted-foreground', pair: false },
  attachment_added: { icon: 'paperclip', tint: 'text-muted-foreground', pair: false },
  link_added: { icon: 'link', tint: 'text-muted-foreground', pair: false },
  link_removed: { icon: 'link', tint: 'text-muted-foreground', pair: false },
  time_logged: { icon: 'clock', tint: 'text-muted-foreground', pair: false },
  problem_linked: { icon: 'puzzle', tint: 'text-muted-foreground', pair: false },
  problem_unlinked: { icon: 'puzzle', tint: 'text-muted-foreground', pair: false },
  resolved: { icon: 'check-circle', tint: 'text-success-ink', pair: false },
  reopened: { icon: 'folder-open', tint: 'text-warning-ink', pair: false },
};

const FALLBACK = { icon: 'circle' as IconName, tint: 'text-muted-foreground', pair: false };

/**
 * The Activity tab: everything that has happened to this ticket, newest first.
 *
 * The order is the server's — this renders the list as it arrives, so there is
 * one place that decides it rather than two that can disagree.
 *
 * **The server sends facts; this builds the sentence.** A row holds a type and
 * two labels, so the same history reads correctly in English and Hindi. An entry
 * that already carried its wording would be frozen in whichever language the
 * person making the change happened to be using.
 *
 * **The labels are history, not live values.** A status renamed since is still
 * shown as it read at the time, because that is what the entry is a record of.
 *
 * Loaded on demand — the tab is opened far less often than the conversation, and
 * the feed grows for the life of the ticket.
 */
@Component({
  selector: 'tk-ticket-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Alert, Avatar, Icon, SkeletonDirective],
  template: `
    @if (feed.value(); as entries) {
      @if (entries.length) {
        <ol class="activity-feed">
          @for (entry of entries; track entry.id) {
            <li class="activity-item">
              <span class="activity-marker" [class]="shape(entry).tint">
                <tk-icon [name]="shape(entry).icon" [size]="13" />
              </span>

              <div class="min-w-0 flex-1 pb-4">
                <p class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body">
                  @if (entry.actor; as who) {
                    <tk-avatar
                      [name]="who.name ?? who.email"
                      [imageUrl]="who.avatarUrl"
                      [size]="20"
                      round
                      class="shrink-0"
                    />
                  }
                  <span class="font-semibold">{{ actorName(entry) }}</span>
                  <span class="text-muted-foreground">{{ verb(entry) }}</span>

                  @if (shape(entry).pair) {
                    <span class="activity-chip">{{ entry.fromLabel ?? emptyLabel() }}</span>
                    <tk-icon name="arrow-up-right" [size]="12" class="rotate-45 text-muted-foreground" />
                    <span class="activity-chip is-to">{{ entry.toLabel ?? emptyLabel() }}</span>
                  } @else if (entry.toLabel) {
                    <span class="activity-chip">{{ detail(entry) }}</span>
                  }
                </p>
                <p class="mt-0.5 text-meta text-muted-foreground">{{ when(entry) }}</p>
              </div>
            </li>
          }
        </ol>
      } @else {
        <!-- Only reachable on a ticket raised before the log existed: everything
             since writes a "created" entry as its first row. -->
        <p class="py-6 text-center text-body text-muted-foreground">
          {{ 'tickets.activity.empty' | transloco }}
        </p>
      }
    } @else if (feed.error()) {
      <tk-alert tone="danger" [heading]="'tickets.activity.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="feed.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <div class="space-y-3 py-2">
        @for (row of skeletons; track row) {
          <span tkSkeleton class="block h-8 w-full"></span>
        }
      </div>
    }
  `,
})
export class TicketActivityFeed {
  private readonly api = inject(TicketsApi);
  private readonly transloco = inject(TranslocoService);

  readonly ticketId = input.required<string>();
  /**
   * Bumped by the parent after any write, to pull the feed forward.
   *
   * A plain number rather than a `viewChild().reload()` call: the parent may not
   * have this component in the tree at all — the tab it lives on is often not
   * the one on screen — and a refresh that silently does nothing is worse than
   * one the template can express.
   */
  readonly version = input(0);

  protected readonly skeletons = [0, 1, 2, 3];

  protected readonly feed = resource({
    params: () => ({ id: this.ticketId(), v: this.version() }),
    loader: ({ params }) => this.api.ticketActivity(params.id),
  });

  protected readonly loadError = computed(() => errorMessage(this.feed.error()));

  protected shape(entry: TicketActivity) {
    return SHAPES[entry.type] ?? FALLBACK;
  }

  /** "Trackly" for the entries nothing human caused — automation, email, the clock. */
  protected actorName(entry: TicketActivity): string {
    const who = entry.actor;
    return who?.name || who?.email || this.transloco.translate('tickets.activity.system');
  }

  /**
   * The wording. Falls back to the raw type rather than an empty string: a row
   * that renders as "Priya   Open → Done" is confusing, but one that renders as
   * "Priya problem_linked" at least says what happened and is a visible sign
   * that a translation key is missing.
   */
  protected verb(entry: TicketActivity): string {
    const key = `tickets.activity.verbs.${entry.type}`;
    const text = this.transloco.translate(key);
    return text === key ? entry.type.replace(/_/g, ' ') : text;
  }

  /**
   * The detail chip for one-sided entries. Minutes are the only value stored raw
   * rather than as a label, because "90" has to become "1h 30m" and the server
   * has no business deciding how that is written.
   */
  protected detail(entry: TicketActivity): string {
    if (entry.type !== 'time_logged') return entry.toLabel ?? '';
    const minutes = Number(entry.toLabel);
    if (!Number.isFinite(minutes)) return entry.toLabel ?? '';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours && rest ? `${hours}h ${rest}m` : hours ? `${hours}h` : `${rest}m`;
  }

  protected emptyLabel(): string {
    return this.transloco.translate('common.none');
  }

  protected when(entry: TicketActivity): string {
    return formatDateTime(entry.createdAt);
  }
}
