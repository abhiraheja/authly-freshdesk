import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { timeAgo, type WidgetConversation } from '@trackly/core';
import { Alert, Button, EmptyState, Icon, SkeletonDirective } from '@trackly/ui';

/**
 * One row of the conversation list. Private to this file — both the open list
 * and the closed section render it, and duplicating the markup is how the two
 * drift apart.
 */
@Component({
  selector: 'tk-widget-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Icon],
  template: `
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-3 text-left transition hover:border-primary/50"
      [class.border-border]="row().unreadCount === 0"
      [class.border-primary]="row().unreadCount > 0"
      (click)="opened.emit(row().id)"
    >
      <span
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[13px] font-bold text-primary-ink"
        aria-hidden="true"
      >
        {{ initial() }}
      </span>

      <span class="min-w-0 flex-1">
        <span class="block truncate text-[14px] text-foreground">
          @if (row().lastSenderName) {
            <span class="font-semibold">{{ row().lastSenderName }}:</span>
          }
          {{ row().preview }}
        </span>
        <span class="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {{ row().subject }} · {{ ago() }}
        </span>
      </span>

      @if (row().unreadCount > 0) {
        <span
          class="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground"
          [attr.aria-label]="'widget.home.unread' | transloco: { count: row().unreadCount }"
        >
          {{ row().unreadCount }}
        </span>
      }
      <tk-icon name="chevron-right" [size]="16" class="shrink-0 text-muted-foreground" />
    </button>
  `,
})
export class WidgetRow {
  readonly row = input.required<WidgetConversation>();
  readonly opened = output<string>();

  protected readonly ago = computed(() => timeAgo(this.row().lastMessageAt));
  protected readonly initial = computed(() => {
    const name = this.row().lastSenderName?.trim();
    return name ? name[0]!.toUpperCase() : '?';
  });
}

/**
 * The panel's home view. The conversation list **is** home — there is no
 * separate index screen (docs/widget-plan.md § 8.1).
 *
 * Open threads always; resolved and closed ones only from the last 30 days, in a
 * section that starts collapsed. The server decides both — this component never
 * filters by age or status, it only groups what it was handed.
 */
@Component({
  selector: 'tk-widget-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Alert, Button, EmptyState, Icon, SkeletonDirective, WidgetRow],
  template: `
    <div class="flex h-full flex-col">
      <div class="flex-1 overflow-y-auto px-4 py-4">
        @if (loading()) {
          <div class="space-y-2" aria-hidden="true">
            <span tkSkeleton class="block h-[68px] w-full rounded-xl"></span>
            <span tkSkeleton class="block h-[68px] w-full rounded-xl"></span>
            <span tkSkeleton class="block h-[68px] w-full rounded-xl"></span>
          </div>
        } @else if (error()) {
          <tk-alert tone="danger" [heading]="'widget.home.loadFailed' | transloco">
            {{ error() }}
            <button type="button" class="ml-1 font-semibold underline" (click)="retry.emit()">
              {{ 'common.retry' | transloco }}
            </button>
          </tk-alert>
        } @else if (open().length) {
          <p class="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {{ 'widget.home.continue' | transloco }}
          </p>
          <ul class="space-y-2">
            @for (row of open(); track row.id) {
              <li><tk-widget-row [row]="row" (opened)="opened.emit($event)" /></li>
            }
          </ul>
        } @else {
          <!-- Two different empties, and the difference matters: "nothing yet"
               invites a first message, "all closed" says the history is below
               rather than missing. -->
          <tk-empty-state
            icon="message-square"
            [heading]="
              (closed().length ? 'widget.home.allClosedHeading' : 'widget.home.emptyHeading') | transloco
            "
            [description]="
              (closed().length ? 'widget.home.allClosedBody' : 'widget.home.emptyBody') | transloco
            "
          />
        }

        @if (!loading() && !error() && closed().length) {
          <div class="mt-4 border-t border-border pt-3">
            <button
              type="button"
              class="flex w-full items-center gap-1.5 rounded-lg px-1 py-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
              [attr.aria-expanded]="showClosed()"
              (click)="showClosed.set(!showClosed())"
            >
              <tk-icon [name]="showClosed() ? 'chevron-down' : 'chevron-right'" [size]="16" />
              {{ 'widget.home.closed' | transloco: { count: closed().length } }}
            </button>

            @if (showClosed()) {
              <ul class="mt-2 space-y-2">
                @for (row of closed(); track row.id) {
                  <li><tk-widget-row [row]="row" (opened)="opened.emit($event)" /></li>
                }
              </ul>
            }
          </div>
        }
      </div>

      <div class="border-t border-border px-4 py-3">
        <button tkButton class="w-full justify-center" (click)="started.emit()">
          <tk-icon name="message-square" [size]="18" />
          {{ 'widget.home.newConversation' | transloco }}
        </button>
      </div>
    </div>
  `,
})
export class WidgetHome {
  readonly conversations = input<WidgetConversation[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly opened = output<string>();
  readonly started = output<void>();
  readonly retry = output<void>();

  protected readonly showClosed = signal(false);

  protected readonly open = computed(() =>
    this.conversations().filter((c) => !isFinished(c.statusCategory)),
  );
  protected readonly closed = computed(() =>
    this.conversations().filter((c) => isFinished(c.statusCategory)),
  );
}

function isFinished(category: string): boolean {
  return category === 'resolved' || category === 'closed';
}
