import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import {
    ChatApi,
  ChatPresence,
  errorMessage,
  settled,
  timeAgo,
  type ChatMessage,
  type ChatSession,
  type HubConnection,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChatThread,
  ConfirmService,
  EmptyState,
  Icon,
  InputDirective,
  PageHeader,
  SkeletonDirective,
  ToastService,
} from '@trackly/ui';

/**
 * The agent's live-chat console: who is waiting, and the conversation.
 *
 * **One hub connection for the whole screen.** It joins the workspace lobby, so
 * a chat that starts while the agent is reading another one appears in the list
 * without a refresh; opening a session joins that session's group as well.
 *
 * REST stays the source of truth — every message is posted over HTTP and echoed
 * locally, and the hub only carries what *other people* send. So a dropped socket
 * degrades to "I stop seeing their replies live", never to "my reply vanished".
 *
 * Ending the chat writes the transcript into a ticket and navigates to it, which
 * is the whole point of a chat on a support desk: the conversation has to survive
 * the window being closed.
 */
@Component({
  selector: 'tk-chat-console',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    ChatThread,
    EmptyState,
    Icon,
    InputDirective,
    PageHeader,
    SkeletonDirective,
  ],
  template: `
    <tk-page-header [title]="'chat.title' | transloco" [subtitle]="subtitle()" />

    @if (!live()) {
      <!-- Said once, plainly. The console still works over REST — a reload shows
           everything — but nobody should discover that by wondering why the list
           stopped moving. -->
      <div class="mb-4">
        <tk-alert tone="warning" [heading]="'chat.offlineHeading' | transloco">
          {{ 'chat.offlineBody' | transloco }}
          <button type="button" class="ml-1 font-semibold underline" (click)="refresh()">
            {{ 'chat.refresh' | transloco }}
          </button>
        </tk-alert>
      </div>
    }

    <div class="grid gap-4 lg:grid-cols-[19rem_1fr]">
      <!-- Waiting room -->
      <tk-card flush class="min-w-0">
        <p class="border-b border-border px-4 py-3 text-label font-bold uppercase tracking-wider text-muted-foreground">
          {{ 'chat.active' | transloco: { count: sessions().length } }}
        </p>

        @if (loadedList()) {
          <div class="max-h-[28rem] overflow-y-auto lg:max-h-[calc(100vh-19rem)]">
            @for (session of sessions(); track session.id) {
              <button
                type="button"
                class="flex w-full flex-col gap-0.5 border-l-[3px] px-4 py-3 text-left transition-colors hover:bg-accent"
                [class]="session.id === selected() ? 'border-primary bg-accent' : 'border-transparent'"
                [attr.aria-current]="session.id === selected() ? 'true' : null"
                (click)="open(session.id)"
              >
                <span class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-body font-semibold">{{ visitor(session) }}</span>
                  <!-- Nobody has answered yet. The one thing worth colouring in
                       this list: it is the queue, not a history. -->
                  @if (!session.agentId) {
                    <tk-badge tone="primary">{{ 'chat.new' | transloco }}</tk-badge>
                  }
                </span>
                <span class="text-meta text-muted-foreground">
                  {{ 'chat.waiting' | transloco: { time: age(session) } }}
                </span>
              </button>
            } @empty {
              <tk-empty-state
                icon="messages-square"
                [heading]="'chat.emptyQueue' | transloco"
                [description]="'chat.emptyQueueBody' | transloco"
              />
            }
          </div>
        } @else if (list.error()) {
          <div class="p-4">
            <tk-alert tone="danger" [heading]="'chat.loadFailed' | transloco">
              {{ listError() }}
              <button type="button" class="ml-1 font-semibold underline" (click)="list.reload()">
                {{ 'common.retry' | transloco }}
              </button>
            </tk-alert>
          </div>
        } @else {
          <div class="space-y-3 p-4">
            @for (row of skeletonRows; track row) {
              <span tkSkeleton class="block h-10 w-full"></span>
            }
          </div>
        }
      </tk-card>

      <!-- Conversation -->
      <tk-card class="min-w-0">
        @if (selected()) {
          <div class="flex h-[32rem] flex-col lg:h-[calc(100vh-16rem)]">
            <div class="mb-2 flex flex-wrap items-center gap-2 border-b border-border pb-3">
              <p class="min-w-0 flex-1 truncate text-card-title font-bold">{{ selectedName() }}</p>
              @if (selectedEmail(); as email) {
                <p class="truncate text-meta text-muted-foreground">{{ email }}</p>
              }
              <button tkButton variant="outline" size="sm" [disabled]="busy()" (click)="end()">
                <tk-icon name="check-circle" [size]="16" />
                {{ 'chat.end' | transloco }}
              </button>
            </div>

            <tk-chat-thread
              [messages]="messages()"
              viewer="agent"
              [youLabel]="'chat.you' | transloco"
              [otherLabel]="'chat.visitor' | transloco"
              [emptyText]="'chat.noMessages' | transloco"
              [typingLabel]="visitorTyping() ? ('chat.visitorTyping' | transloco) : null"
            />

            <div class="mt-3 flex items-end gap-2 border-t border-border pt-3">
              <label class="sr-only" for="chat-reply">{{ 'chat.replyLabel' | transloco }}</label>
              <input
                tkInput
                inset
                id="chat-reply"
                autocomplete="off"
                [placeholder]="'chat.replyPlaceholder' | transloco"
                [disabled]="busy()"
                [ngModel]="draft()"
                (ngModelChange)="onDraft($event)"
                (keydown.enter)="send()"
              />
              <button tkButton class="shrink-0" [disabled]="!canSend()" (click)="send()">
                <tk-icon name="send" [size]="16" />
                <span class="hidden sm:inline">{{ 'chat.send' | transloco }}</span>
              </button>
            </div>

            @if (sendError(); as message) {
              <div class="mt-3">
                <tk-alert tone="danger">{{ message }}</tk-alert>
              </div>
            }
          </div>
        } @else {
          <tk-empty-state
            icon="message-square"
            [heading]="'chat.pickHeading' | transloco"
            [description]="'chat.pickBody' | transloco"
          />
        }
      </tk-card>
    </div>
  `,
})
export class ChatConsole {
  private readonly api = inject(ChatApi);
  private readonly presence = inject(ChatPresence);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  protected readonly skeletonRows = [0, 1, 2];

  /** The first load. Live arrivals are folded into `extra` rather than refetched. */
  protected readonly list = resource({ loader: () => this.api.sessions() });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedList = settled(() => this.list);

  /**
   * Sessions the hub told us about, and ones it told us have ended.
   *
   * Kept beside the fetched list rather than reloading it on every event: a chat
   * that starts while an agent is mid-sentence must not cause the list under
   * their cursor to be rebuilt.
   */
  private readonly arrived = signal<readonly ChatSession[]>([]);
  private readonly finished = signal<ReadonlySet<string>>(new Set());

  protected readonly sessions = computed(() => {
    const seen = new Set<string>();
    const ended = this.finished();
    return [...(this.loadedList() ?? []), ...this.arrived()].filter((session) => {
      if (ended.has(session.id) || seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    });
  });

  protected readonly selected = signal<string | null>(null);
  protected readonly messages = signal<readonly ChatMessage[]>([]);
  protected readonly draft = signal('');
  protected readonly visitorTyping = signal(false);
  protected readonly busy = signal(false);
  protected readonly sendError = signal<string | null>(null);
  protected readonly live = signal(true);

  protected readonly listError = computed(() => errorMessage(this.list.error()));
  protected readonly canSend = computed(() => !this.busy() && this.draft().trim().length > 0);

  private readonly selectedSession = computed(() =>
    this.sessions().find((session) => session.id === this.selected()) ?? null,
  );

  protected readonly selectedName = computed(() =>
    this.selectedSession() ? this.visitor(this.selectedSession()!) : '',
  );
  protected readonly selectedEmail = computed(() => this.selectedSession()?.visitorEmail ?? '');

  protected readonly subtitle = computed(() => {
    this.lang();
    const count = this.sessions().length;
    return this.transloco.translate(count === 1 ? 'chat.subtitleOne' : 'chat.subtitle', { count });
  });

  private connection: HubConnection | null = null;

  constructor() {
    const connection = this.api.connect();
    this.connection = connection;

    connection.on('session', (session: ChatSession) => {
      this.arrived.update((current) =>
        current.some((s) => s.id === session.id) ? current : [...current, session],
      );
    });

    connection.on('ended', (event: { sessionId: string }) => {
      this.finished.update((current) => new Set(current).add(event.sessionId));
      // Only clears the pane if it was the one on screen. Another agent closing
      // their chat must not wipe the conversation you are typing into.
      if (this.selected() === event.sessionId) this.clearSelection();
    });

    connection.on('message', (message: ChatMessage) => {
      if (message.sessionId !== this.selected()) return;
      this.visitorTyping.set(false);
      this.append(message);
    });

    connection.on('typing', (sender: string, isTyping: boolean) => {
      if (sender === 'visitor') this.visitorTyping.set(isTyping);
    });

    connection.onreconnected(() => {
      this.live.set(true);
      // The socket was down; anything that happened meanwhile is only in the
      // database. Rejoin and re-read rather than pretending nothing was missed.
      const id = this.selected();
      if (id) void connection.invoke('JoinSession', id).catch(() => {});
      this.refresh();
    });
    connection.onreconnecting(() => this.live.set(false));
    connection.onclose(() => this.live.set(false));

    connection.start().catch(() => this.live.set(false));

    inject(DestroyRef).onDestroy(() => {
      this.connection = null;
      void connection.stop().catch(() => {});
    });
  }

  protected visitor(session: ChatSession): string {
    return session.visitorName || session.visitorEmail || this.transloco.translate('chat.visitor');
  }

  protected age(session: ChatSession): string {
    return timeAgo(session.createdAt);
  }

  protected refresh(): void {
    this.arrived.set([]);
    this.list.reload();
  }

  protected async open(id: string): Promise<void> {
    this.selected.set(id);
    this.visitorTyping.set(false);
    this.sendError.set(null);
    this.messages.set([]);
    // Somebody is now looking at it, so it stops counting against the rail's
    // badge. Told rather than inferred: the presence store cannot see which
    // conversation is on screen.
    this.presence.markSeen(id);

    try {
      const thread = await this.api.thread(id);
      this.messages.set(thread.messages);
      await this.connection?.invoke('JoinSession', id).catch(() => {});
    } catch (error) {
      this.sendError.set(errorMessage(error));
    }
  }

  /** Typing is a hint, not state — a failed relay is not worth telling anyone. */
  protected onDraft(value: string): void {
    this.draft.set(value);
    const id = this.selected();
    if (id) void this.connection?.invoke('Typing', id, 'agent', value.length > 0).catch(() => {});
  }

  protected async send(): Promise<void> {
    const id = this.selected();
    const body = this.draft().trim();
    if (!id || !body || this.busy()) return;

    this.busy.set(true);
    this.sendError.set(null);
    try {
      void this.connection?.invoke('Typing', id, 'agent', false).catch(() => {});
      const message = await this.api.send(id, body);
      this.draft.set('');
      // Echoed locally: the hub sends to OTHERS in the group, so without this an
      // agent would not see their own line until they reloaded.
      this.append(message);
    } catch (error) {
      this.sendError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Ends the chat, which turns the transcript into a ticket.
   *
   * Confirmed: the visitor's window closes with it, and there is no reopening a
   * chat — the follow-up happens on the ticket instead.
   */
  protected async end(): Promise<void> {
    const id = this.selected();
    if (!id) return;

    const ok = await this.confirm.ask({
      heading: this.transloco.translate('chat.endHeading'),
      message: this.transloco.translate('chat.endMessage'),
      confirmLabel: this.transloco.translate('chat.endConfirm'),
      tone: 'success',
    });
    if (!ok) return;

    this.busy.set(true);
    try {
      const { ticketId } = await this.api.end(id);
      this.finished.update((current) => new Set(current).add(id));
      this.clearSelection();
      this.toast.success(this.transloco.translate('chat.ended'));
      await this.router.navigate(['/dashboard/tickets', ticketId]);
    } catch (error) {
      this.sendError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private append(message: ChatMessage): void {
    this.messages.update((current) =>
      current.some((m) => m.id === message.id) ? current : [...current, message],
    );
  }

  private clearSelection(): void {
    this.selected.set(null);
    this.messages.set([]);
    this.draft.set('');
    this.visitorTyping.set(false);
  }
}
