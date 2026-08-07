import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { NotificationsApi, timeAgo, valueOr, type AppNotification } from '@trackly/core';
import { Avatar, Button, Dropdown, Icon, Spinner, type IconName } from '@trackly/ui';

/** Type → icon. A static lookup; an unknown type still gets a sensible glyph. */
const TYPE_ICON: Record<string, IconName> = {
  mention: 'at-sign',
  watching: 'eye',
  assigned: 'user-check',
  reply: 'message-square',
};

/** How often the badge re-checks. Slow on purpose — see the class comment. */
const POLL_MS = 60_000;

/**
 * The bell in the top bar.
 *
 * **Polled, not pushed.** Trackly already runs SignalR for live chat, and a
 * notification hub would be the better answer eventually. It is not the answer
 * today: the hub would need its own per-user group management and a reconnect
 * story, and the thing being delivered is a number that changes a few times an
 * hour. A minute of latency on "you were mentioned" costs nothing; the email
 * has already gone out anyway.
 *
 * The list is only fetched when the menu opens. The badge is the hot path and it
 * is a single integer — pulling fifty rows a minute to render a number would be
 * the expensive way to say the same thing.
 */
@Component({
  selector: 'tk-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Avatar, Button, Dropdown, Icon, Spinner],
  template: `
    <tk-dropdown align="end">
      <button
        tkButton
        variant="ghost"
        iconOnly
        dropdown-trigger
        class="relative"
        [attr.aria-label]="bellLabel()"
        (click)="onOpen()"
      >
        <tk-icon name="bell" [size]="20" />
        @if (api.unread() > 0) {
          <!-- A count, not a dot. "You have something" and "you have eleven
               things" are different messages and only one of them is urgent. -->
          <span class="notification-badge">{{ badgeText() }}</span>
        }
      </button>

      <div dropdown-menu>
        <div class="w-[22rem] max-w-[calc(100vw-2rem)]">
          <div class="flex items-center justify-between gap-2 px-2.5 pb-1 pt-1.5">
            <p class="text-meta font-bold text-muted-foreground">
              {{ 'nav.notifications' | transloco }}
            </p>
            @if (api.unread() > 0) {
              <!-- stopPropagation: the dropdown closes on any click inside it,
                   and marking everything read should leave the list open so the
                   change is visible. -->
              <button
                type="button"
                class="text-meta font-semibold text-primary hover:underline"
                (click)="markAll($event)"
              >
                {{ 'notifications.markAllRead' | transloco }}
              </button>
            }
          </div>

          @if (feed.isLoading() && !feed.value()) {
            <p class="flex items-center justify-center gap-2 px-2.5 py-6 text-body text-muted-foreground">
              <tk-spinner [size]="16" />
              {{ 'common.loading' | transloco }}
            </p>
          } @else if (feed.error()) {
            <p class="px-2.5 py-6 text-center text-body text-danger">
              {{ 'notifications.loadFailed' | transloco }}
            </p>
          } @else {
            <ul class="max-h-[26rem] overflow-y-auto">
              @for (item of list(); track item.id) {
                <li>
                  <button type="button" class="notification-row" [class.is-unread]="!item.isRead" (click)="open(item)">
                    @if (item.actor; as actor) {
                      <tk-avatar
                        [name]="actor.name || actor.email"
                        [imageUrl]="actor.avatarUrl"
                        [size]="28"
                        round
                        class="mt-0.5 shrink-0"
                      />
                    } @else {
                      <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                        <tk-icon [name]="icon(item)" [size]="14" />
                      </span>
                    }
                    <span class="min-w-0 flex-1">
                      <span class="block text-body">{{ headline(item) }}</span>
                      @if (item.ticketSubject) {
                        <span class="block truncate text-meta font-semibold text-foreground">
                          {{ item.ticketSubject }}
                        </span>
                      }
                      @if (item.preview) {
                        <span class="block truncate text-meta text-muted-foreground">{{ item.preview }}</span>
                      }
                      <span class="mt-0.5 block text-meta text-muted-foreground">{{ when(item) }}</span>
                    </span>
                    @if (!item.isRead) {
                      <span class="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
                    }
                  </button>
                </li>
              } @empty {
                <li class="px-2.5 py-6 text-center text-body text-muted-foreground">
                  {{ 'nav.allCaughtUp' | transloco }}
                </li>
              }
            </ul>
          }
        </div>
      </div>
    </tk-dropdown>
  `,
})
export class NotificationBell {
  protected readonly api = inject(NotificationsApi);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  /** Fetched on first open, not on mount — see the class comment. */
  private readonly opened = signal(false);

  protected readonly feed = resource({
    params: () => ({ opened: this.opened() }),
    loader: ({ params }) => (params.opened ? this.api.list() : Promise.resolve([])),
  });

  protected readonly list = computed(() => valueOr(this.feed, []));

  protected readonly badgeText = computed(() => {
    const count = this.api.unread();
    // Past ninety-nine the exact number stops being information and starts
    // being a wide badge.
    return count > 99 ? '99+' : String(count);
  });

  constructor() {
    void this.api.refreshCount();
    const handle = setInterval(() => void this.api.refreshCount(), POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(handle));
  }

  protected bellLabel(): string {
    const count = this.api.unread();
    return count > 0
      ? this.transloco.translate('notifications.unreadLabel', { count })
      : this.transloco.translate('nav.notifications');
  }

  protected icon(item: AppNotification): IconName {
    return TYPE_ICON[item.type] ?? 'bell';
  }

  protected when(item: AppNotification): string {
    return timeAgo(item.createdAt);
  }

  /**
   * The sentence, built here rather than stored.
   *
   * The row holds what happened and who did it; storing "Priya mentioned you"
   * would freeze it in whatever language the server was running in.
   */
  protected headline(item: AppNotification): string {
    const actor = item.actor?.name || item.actor?.email || this.transloco.translate('notifications.someone');
    return this.transloco.translate(`notifications.types.${item.type}`, { actor });
  }

  protected onOpen(): void {
    if (this.opened()) this.feed.reload();
    else this.opened.set(true);
    void this.api.refreshCount();
  }

  /**
   * Marks read and goes to the ticket. Both, because opening the thing is the
   * only reliable evidence that somebody read it — a separate "mark read"
   * button is a chore nobody performs.
   */
  protected async open(item: AppNotification): Promise<void> {
    if (!item.isRead) {
      // Not awaited: the navigation is what the click was for, and a slow
      // network should not hold it up. A failed mark leaves the row unread,
      // which is the safe direction to be wrong in.
      void this.api.markRead(item.id);
    }
    if (item.ticketId) await this.router.navigate(['/dashboard/tickets', item.ticketId]);
    this.feed.reload();
  }

  protected async markAll(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.api.markAllRead();
    this.feed.reload();
  }
}
