import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChatApi,
  PublicApi,
  errorMessage,
  fromQuery,
  type ChatMessage,
  type HubConnection,
} from '@trackly/core';
import {
  Alert,
  BrandedFrame,
  Button,
  Card,
  ChatThread,
  Icon,
  InputDirective,
  LabelDirective,
  Spinner,
} from '@trackly/ui';

/** Where a visitor's credentials live between reloads. See `restore()`. */
const STORAGE_KEY = 'trackly-chat';

interface StoredSession {
  readonly slug: string;
  readonly sessionId: string;
  readonly token: string;
}

/**
 * The customer's live-chat window — `/chat?workspace=<slug>`.
 *
 * Anonymous: starting a chat mints a session token that **is** the visitor's
 * identity for the rest of it. It is kept in `sessionStorage` so a reload does
 * not drop somebody mid-sentence, and dies with the tab — which is the right
 * lifetime for a support chat on a shared machine.
 *
 * Ending it hands back a ticket id, and the last thing this screen does is show
 * it: the conversation outlives the window, and the reference is what lets them
 * follow it up by email.
 */
@Component({
  selector: 'tk-chat-visitor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    BrandedFrame,
    Button,
    Card,
    ChatThread,
    Icon,
    InputDirective,
    LabelDirective,
    Spinner,
  ],
  template: `
    <tk-branded-frame
      [brandName]="brandName()"
      [logoUrl]="branding.value()?.logoUrl ?? null"
      [accent]="accent()"
      [footerText]="branding.value()?.footerText ?? ''"
      [hidePoweredBy]="branding.value()?.hidePoweredBy ?? false"
      [maxWidth]="560"
    >
      @switch (phase()) {
        @case ('start') {
          <tk-card>
            <div class="space-y-4">
              <header>
                <h1 class="font-display text-page font-extrabold">{{ 'chat.visitor.title' | transloco }}</h1>
                <p class="mt-1 text-body text-muted-foreground">{{ 'chat.visitor.subtitle' | transloco }}</p>
              </header>

              <!-- Both optional. Making a name mandatory to ask a question is a
                   toll on the person already having a bad day; the ticket the
                   transcript becomes carries whatever they gave. -->
              <div>
                <label tkLabel for="chat-name">{{ 'chat.visitor.name' | transloco }}</label>
                <input tkInput id="chat-name" name="chat-name" [(ngModel)]="name" />
              </div>
              <div>
                <label tkLabel for="chat-email">{{ 'chat.visitor.email' | transloco }}</label>
                <input tkInput id="chat-email" name="chat-email" type="email" [(ngModel)]="email" />
                <p class="mt-1.5 text-meta text-muted-foreground">{{ 'chat.visitor.emailHint' | transloco }}</p>
              </div>

              @if (error(); as message) {
                <tk-alert tone="danger">{{ message }}</tk-alert>
              }

              <button tkButton [disabled]="busy()" (click)="start()">
                @if (busy()) {
                  <tk-spinner [size]="16" />
                }
                {{ 'chat.visitor.start' | transloco }}
              </button>
            </div>
          </tk-card>
        }

        @case ('chatting') {
          <tk-card>
            <div class="flex h-[30rem] flex-col">
              <div class="mb-2 flex items-center gap-2 border-b border-border pb-3">
                <span class="size-2 shrink-0 rounded-full" [class]="live() ? 'bg-success' : 'bg-warning'"></span>
                <p class="min-w-0 flex-1 truncate text-body font-semibold">
                  {{ (live() ? 'chat.visitor.connected' : 'chat.visitor.reconnecting') | transloco }}
                </p>
                <button tkButton variant="ghost" size="sm" [disabled]="busy()" (click)="end()">
                  {{ 'chat.visitor.end' | transloco }}
                </button>
              </div>

              <tk-chat-thread
                [messages]="messages()"
                viewer="visitor"
                [youLabel]="'chat.you' | transloco"
                [otherLabel]="'chat.visitor.support' | transloco"
                [emptyText]="'chat.visitor.opener' | transloco"
                [typingLabel]="agentTyping() ? ('chat.visitor.agentTyping' | transloco) : null"
              />

              <div class="mt-3 flex items-end gap-2 border-t border-border pt-3">
                <label class="sr-only" for="chat-message">{{ 'chat.visitor.messageLabel' | transloco }}</label>
                <input
                  tkInput
                  inset
                  id="chat-message"
                  autocomplete="off"
                  [placeholder]="'chat.visitor.messagePlaceholder' | transloco"
                  [disabled]="busy()"
                  [ngModel]="draft()"
                  (ngModelChange)="onDraft($event)"
                  (keydown.enter)="send()"
                />
                <button tkButton class="shrink-0" [disabled]="!canSend()" (click)="send()">
                  <tk-icon name="send" [size]="16" />
                </button>
              </div>

              @if (error(); as message) {
                <div class="mt-3">
                  <tk-alert tone="danger">{{ message }}</tk-alert>
                </div>
              }
            </div>
          </tk-card>
        }

        @case ('ended') {
          <tk-card>
            <div class="space-y-3 py-4 text-center">
              <tk-icon name="check-circle" [size]="28" class="text-success" />
              <h1 class="font-display text-section font-bold">{{ 'chat.visitor.endedHeading' | transloco }}</h1>
              <p class="text-body text-muted-foreground">{{ 'chat.visitor.endedBody' | transloco }}</p>
              @if (ticketRef(); as reference) {
                <p class="text-body">
                  {{ 'chat.visitor.reference' | transloco }}
                  <span class="font-mono font-semibold">#{{ reference }}</span>
                </p>
              }
            </div>
          </tk-card>
        }
      }
    </tk-branded-frame>
  `,
})
export class ChatVisitor {
  private readonly api = inject(ChatApi);
  private readonly publicApi = inject(PublicApi);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  /** `?workspace=acme`. Empty resolves to the single workspace server-side. */
  readonly workspace = input('', { transform: fromQuery });

  protected readonly branding = resource({
    params: () => ({ slug: this.workspace() }),
    loader: ({ params }) => this.publicApi.branding(params.slug || 'default'),
  });

  protected readonly brandName = computed(() => this.branding.value()?.workspaceName ?? '');
  protected readonly accent = computed(() => this.branding.value()?.primaryColor ?? null);

  protected readonly phase = signal<'start' | 'chatting' | 'ended'>('start');
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly draft = signal('');
  protected readonly messages = signal<readonly ChatMessage[]>([]);
  protected readonly agentTyping = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly live = signal(false);
  protected readonly ticketRef = signal<string | null>(null);

  protected readonly canSend = computed(() => !this.busy() && this.draft().trim().length > 0);

  private session: StoredSession | null = null;
  private connection: HubConnection | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disconnect());
    void this.restore();
  }

  /**
   * Picks a chat back up after a reload.
   *
   * The stored credentials are checked against the server before being trusted:
   * a chat an agent ended while the tab was closed must not come back as an open
   * window that silently fails on every send.
   */
  private async restore(): Promise<void> {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    let stored: StoredSession;
    try {
      stored = JSON.parse(raw) as StoredSession;
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }

    try {
      const thread = await this.api.visitorThread(stored.sessionId, stored.token);
      if (thread.session.status !== 'active') {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      this.session = stored;
      this.messages.set(thread.messages);
      this.phase.set('chatting');
      this.connect();
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  protected async start(): Promise<void> {
    if (this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      const slug = this.workspace() || 'default';
      const started = await this.api.start(slug, this.name().trim() || undefined, this.email().trim() || undefined);
      this.session = { slug, sessionId: started.sessionId, token: started.token };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));

      const thread = await this.api.visitorThread(started.sessionId, started.token);
      this.messages.set(thread.messages);
      this.phase.set('chatting');
      this.connect();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected onDraft(value: string): void {
    this.draft.set(value);
    const session = this.session;
    if (session) {
      void this.connection?.invoke('Typing', session.sessionId, 'visitor', value.length > 0).catch(() => {});
    }
  }

  protected async send(): Promise<void> {
    const session = this.session;
    const body = this.draft().trim();
    if (!session || !body || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      void this.connection?.invoke('Typing', session.sessionId, 'visitor', false).catch(() => {});
      const message = await this.api.visitorSend(session.sessionId, session.token, body);
      this.draft.set('');
      this.append(message);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async end(): Promise<void> {
    const session = this.session;
    if (!session || this.busy()) return;

    this.busy.set(true);
    try {
      const { ticketId } = await this.api.visitorEnd(session.sessionId, session.token);
      this.finish(ticketId);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private connect(): void {
    const session = this.session;
    if (!session) return;

    const connection = this.api.connect({ sessionId: session.sessionId, token: session.token });
    this.connection = connection;

    connection.on('message', (message: ChatMessage) => {
      this.agentTyping.set(false);
      this.append(message);
    });
    connection.on('typing', (sender: string, isTyping: boolean) => {
      if (sender === 'agent') this.agentTyping.set(isTyping);
    });
    connection.on('ended', (event: { ticketId?: string }) => this.finish(event.ticketId ?? null));

    connection.onreconnected(() => this.live.set(true));
    connection.onreconnecting(() => this.live.set(false));
    connection.onclose(() => this.live.set(false));

    connection.start().then(
      () => this.live.set(true),
      // REST still works, so the chat is usable — it just stops updating on its
      // own. The header dot says so rather than the page pretending it is fine.
      () => this.live.set(false),
    );
  }

  private finish(ticketId: string | null): void {
    sessionStorage.removeItem(STORAGE_KEY);
    this.session = null;
    this.ticketRef.set(ticketId ? ticketId.slice(0, 8) : null);
    this.phase.set('ended');
    this.disconnect();
  }

  private disconnect(): void {
    const connection = this.connection;
    this.connection = null;
    void connection?.stop().catch(() => {});
  }

  private append(message: ChatMessage): void {
    this.messages.update((current) =>
      current.some((m) => m.id === message.id) ? current : [...current, message],
    );
  }
}
