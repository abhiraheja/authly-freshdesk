import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ApiError,
  ThemeService,
  WidgetApi,
  WidgetVisitorStore,
  brandVars,
  errorMessage,
  type WidgetConversation,
  type WidgetPublicConfig,
  type WidgetSession,
  type WidgetThread as Thread,
} from '@trackly/core';
import { Alert, Icon, Spinner } from '@trackly/ui';
import { WidgetBridge } from './widget-bridge';
import { WidgetDetails } from './widget-details';
import { WidgetHome } from './widget-home';
import { WidgetThread } from './widget-thread';

type View = 'home' | 'details' | 'thread';

/** How often the list is refreshed. The unread badge is only ever this stale. */
const LIST_POLL_MS = 20_000;
/** The open thread refreshes faster — someone is looking at it. */
const THREAD_POLL_MS = 10_000;

/**
 * The embedded panel (docs/widget-plan.md § 8.1) — one frame, four views, and
 * the frame never navigates. Swapping views rather than routing is what keeps
 * the launcher's position and an in-progress draft alive across a "back".
 *
 * <h3>Customer-facing, so: the workspace's brand, always light</h3>
 * Invariant 6. {@link brandVars} re-points the primary tokens at the widget's
 * colour on the root element here, which re-brands every control inside it
 * without a single interpolated class name; {@link ThemeService.forceLight}
 * blocks dark mode for as long as this component lives.
 *
 * <h3>What this component does not decide</h3>
 * Which conversations exist. The trust rule (§ 3.3) is enforced server-side, and
 * nothing here filters a list or hides a message — a panel that decided what to
 * show would be a panel that could be made to show more.
 */
@Component({
  selector: 'tk-widget-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Alert, Icon, Spinner, WidgetHome, WidgetDetails, WidgetThread],
  host: { class: 'block h-full' },
  template: `
    <div class="flex h-full flex-col bg-background" [style]="brand()">
      @if (config(); as widget) {
        <!-- ── Chrome: left slot · title block · window controls ── -->
        <header class="shrink-0 bg-primary px-4 py-3 text-primary-foreground">
          <div class="flex items-start gap-2">
            @if (view() !== 'home') {
              <button
                type="button"
                class="-ml-1 rounded-lg p-1.5 transition hover:bg-black/10"
                [attr.aria-label]="'widget.back' | transloco"
                (click)="goHome()"
              >
                <tk-icon name="chevron-left" [size]="20" />
              </button>
            }

            <div class="min-w-0 flex-1 py-0.5">
              <p class="truncate text-[15px] font-bold leading-tight">{{ title(widget) }}</p>
              @if (subtitle(widget); as sub) {
                <p class="mt-0.5 truncate text-[12px] opacity-85">{{ sub }}</p>
              }
            </div>

            @if (view() === 'home') {
              @if (widget.showCloseButton) {
                <button
                  type="button"
                  class="rounded-lg p-1.5 transition hover:bg-black/10"
                  [attr.aria-label]="'widget.close' | transloco"
                  (click)="bridge.requestClose()"
                >
                  <tk-icon name="x" [size]="20" />
                </button>
              }
            } @else {
              <!-- Full screen, then minimise. Closing from home discards nothing;
                   a thread minimises so the visitor can come back to it. -->
              <button
                type="button"
                class="rounded-lg p-1.5 transition hover:bg-black/10"
                [attr.aria-label]="(bridge.expanded() ? 'widget.collapse' : 'widget.expand') | transloco"
                (click)="bridge.toggleExpanded()"
              >
                <tk-icon [name]="bridge.expanded() ? 'minimize-2' : 'maximize-2'" [size]="18" />
              </button>
              <button
                type="button"
                class="rounded-lg p-1.5 transition hover:bg-black/10"
                [attr.aria-label]="'widget.minimise' | transloco"
                (click)="bridge.requestClose()"
              >
                <tk-icon name="minus" [size]="20" />
              </button>
            }
          </div>
        </header>

        @if (identityWarning(); as warning) {
          <div class="px-4 pt-3">
            <tk-alert tone="warning">{{ warning }}</tk-alert>
          </div>
        }

        <!-- ── Body ── -->
        <main class="min-h-0 flex-1">
          @switch (view()) {
            @case ('home') {
              <tk-widget-home
                [conversations]="conversations()"
                [loading]="listLoading()"
                [error]="listError()"
                (opened)="openConversation($event)"
                (started)="startNew()"
                (retry)="reloadList()"
              />
            }
            @case ('details') {
              <tk-widget-details
                [busy]="savingDetails()"
                [initialName]="session()?.name ?? null"
                [initialEmail]="session()?.email ?? null"
                [initialPhone]="session()?.phone ?? null"
                (skipped)="afterDetails()"
                (saved)="saveDetails($event)"
              />
            }
            @case ('thread') {
              <tk-widget-thread
                [thread]="thread()"
                [loading]="threadLoading()"
                [error]="threadError()"
                [sending]="sending()"
                [sendError]="sendError()"
                [showSendButton]="widget.showSendButton"
                [fileUrl]="fileUrl()"
                (sent)="send($event)"
                (retry)="reloadThread()"
              />
            }
          }
        </main>

        @if (!widget.hidePoweredBy) {
          <footer class="shrink-0 border-t border-border py-1.5 text-center text-[11px] text-muted-foreground">
            {{ 'widget.poweredBy' | transloco }}
          </footer>
        }
      } @else if (configError()) {
        <div class="flex h-full items-center justify-center p-6">
          <tk-alert tone="danger" [heading]="'widget.unavailable' | transloco">
            {{ configError() }}
          </tk-alert>
        </div>
      } @else {
        <div class="flex h-full items-center justify-center">
          <tk-spinner [size]="28" />
          <span class="sr-only">{{ 'common.loading' | transloco }}</span>
        </div>
      }
    </div>
  `,
})
export class WidgetPanel {
  /** The widget's public token, from `/widget/:token`. */
  readonly token = input.required<string>();

  private readonly api = inject(WidgetApi);
  private readonly visitor = inject(WidgetVisitorStore);
  private readonly theme = inject(ThemeService);
  protected readonly bridge = inject(WidgetBridge);

  // ---- Config --------------------------------------------------------------
  //
  // Two plain signals rather than `resource()`. `resource.value()` **throws**
  // while the resource is in its error state, so the idiomatic
  // `@if (config.value(); as w) { } @else if (config.error()) { }` never reaches
  // its error branch — it throws out of change detection first and leaves an
  // empty iframe. On a surface a customer sees, that failure mode is a blank
  // white box with no way to tell whether it is broken or still loading.

  protected readonly config = signal<WidgetPublicConfig | null>(null);
  protected readonly configError = signal<string | null>(null);

  protected readonly brand = computed(() => brandVars(this.config()?.primaryColor));

  // ---- Session -------------------------------------------------------------

  protected readonly session = signal<WidgetSession | null>(null);
  protected readonly identityWarning = signal<string | null>(null);

  // ---- View ----------------------------------------------------------------

  protected readonly view = signal<View>('home');
  private readonly activeId = signal<string | null>(null);

  /**
   * True while the details form is standing in front of a new conversation.
   * Reset on every "Send us a message", because Skip applies to one conversation
   * and not to the visitor (§ 8.1).
   */
  private readonly detailsBeforeNew = signal(false);

  protected readonly savingDetails = signal(false);

  // ---- Conversations -------------------------------------------------------

  protected readonly conversations = signal<WidgetConversation[]>([]);
  protected readonly listLoading = signal(true);
  protected readonly listError = signal<string | null>(null);

  protected readonly thread = signal<Thread | null>(null);
  protected readonly threadLoading = signal(false);
  protected readonly threadError = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);

  protected readonly fileUrl = computed(() => {
    const token = this.token();
    const conversationId = this.activeId();
    return (attachmentId: string) =>
      conversationId ? this.api.attachmentUrl(token, conversationId, attachmentId) : '';
  });

  constructor() {
    // A customer surface never participates in dark mode (invariant 6). Released
    // on destroy so a visitor's own preference survives.
    const release = this.theme.forceLight();
    inject(DestroyRef).onDestroy(() => release());

    // `untracked` around the body: boot writes signals it would otherwise be
    // subscribed to, and an effect that re-runs on its own writes never stops.
    effect(() => {
      const token = this.token();
      untracked(() => void this.boot(token));
    });

    // The unread total is the launcher's badge. Reported on every list change,
    // including back to zero — a badge that only ever counted up would never
    // clear.
    effect(() => {
      const total = this.conversations().reduce((sum, c) => sum + c.unreadCount, 0);
      this.bridge.reportUnread(total);
    });

    this.startPolling();
  }

  // ---- Boot ----------------------------------------------------------------

  private async boot(token: string): Promise<void> {
    this.visitor.use(token);

    try {
      this.config.set(await this.api.config(token));
    } catch (error) {
      // 403 is the allowed-domains list refusing this site, and it is the single
      // most likely reason an embed shows nothing. Say which it is.
      this.configError.set(
        error instanceof ApiError && error.status === 403
          ? 'This site is not allowed to load this widget.'
          : errorMessage(error),
      );
      return;
    }

    // Wait for the loader before opening a session. A session started first
    // would be an anonymous visitor that the host page's identity then has to
    // correct — and on a page with a signed token, that is a visible flicker
    // from "tell us who you are" to "hello Alice".
    await this.bridge.waitForHost();

    try {
      const identity = this.bridge.identity();
      const session = await this.api.startSession(token, identity ?? undefined);
      this.applySession(session);
    } catch (error) {
      this.listError.set(errorMessage(error));
      this.listLoading.set(false);
      return;
    }

    await this.reloadList();
  }

  private applySession(session: WidgetSession): void {
    if (session.visitorToken) this.visitor.set(session.visitorToken);
    this.session.set(session);
    // Shown, not swallowed: an identity that was refused is almost always a bug
    // in the embedding page, and the developer who can fix it is the one looking
    // at this panel.
    this.identityWarning.set(session.identityError);
  }

  // ---- List and thread -----------------------------------------------------

  protected async reloadList(): Promise<void> {
    if (!this.visitor.token()) return;
    this.listError.set(null);
    try {
      this.conversations.set(await this.api.conversations(this.token()));
    } catch (error) {
      this.listError.set(errorMessage(error));
    } finally {
      this.listLoading.set(false);
    }
  }

  protected async reloadThread(): Promise<void> {
    const id = this.activeId();
    if (!id) return;
    this.threadError.set(null);
    try {
      this.thread.set(await this.api.thread(this.token(), id));
    } catch (error) {
      this.threadError.set(errorMessage(error));
    } finally {
      this.threadLoading.set(false);
    }
  }

  protected async openConversation(id: string): Promise<void> {
    this.activeId.set(id);
    this.thread.set(null);
    this.threadLoading.set(true);
    this.sendError.set(null);
    this.view.set('thread');

    await this.reloadThread();

    // Opening clears the badge, and the receipt is what stops it coming back on
    // the next poll (§ 8.1, unread step 3).
    try {
      await this.api.markRead(this.token(), id);
      this.conversations.update((rows) =>
        rows.map((row) => (row.id === id ? { ...row, unreadCount: 0 } : row)),
      );
    } catch {
      // A failed receipt costs a badge that reappears, not a broken thread.
    }
  }

  /** "Send us a message" — the details form first, if it is owed. */
  protected startNew(): void {
    this.activeId.set(null);
    this.thread.set(null);
    this.sendError.set(null);

    if (this.wantsDetails()) {
      this.detailsBeforeNew.set(true);
      this.view.set('details');
      return;
    }
    this.view.set('thread');
  }

  private wantsDetails(): boolean {
    const widget = this.config();
    const session = this.session();
    if (!widget?.showWidgetForm || !session) return false;
    // A proven identity is never asked: the host page or an emailed code has
    // already answered the question this form asks.
    if (session.isVerified) return false;
    return session.showDetailsForm || !session.name;
  }

  protected async saveDetails(values: { name: string; mail: string; number: string }): Promise<void> {
    this.savingDetails.set(true);
    try {
      this.applySession(await this.api.updateSession(this.token(), values));
      this.afterDetails();
    } catch (error) {
      this.identityWarning.set(errorMessage(error));
    } finally {
      this.savingDetails.set(false);
    }
  }

  /** Skip and Submit land in the same place — the composer they interrupted. */
  protected afterDetails(): void {
    this.detailsBeforeNew.set(false);
    this.view.set('thread');
  }

  // ---- Sending -------------------------------------------------------------

  protected async send(payload: { message: string; file: File | null }): Promise<void> {
    this.sending.set(true);
    this.sendError.set(null);
    try {
      let id = this.activeId();

      if (!id) {
        // The first send is what creates the ticket, not opening the composer.
        const created = await this.api.createConversation(this.token(), { message: payload.message });
        id = created.id;
        this.activeId.set(id);
      } else {
        await this.api.reply(this.token(), id, payload.message);
      }

      if (payload.file) {
        try {
          await this.api.uploadAttachment(this.token(), id, payload.file);
        } catch (error) {
          // The message is already sent. Say the attachment failed rather than
          // failing the whole send — otherwise they retype the message too.
          this.sendError.set(errorMessage(error));
        }
      }

      await Promise.all([this.reloadThread(), this.reloadList()]);
    } catch (error) {
      this.sendError.set(errorMessage(error));
    } finally {
      this.sending.set(false);
    }
  }

  protected goHome(): void {
    this.view.set('home');
    this.detailsBeforeNew.set(false);
    void this.reloadList();
  }

  // ---- Chrome copy ---------------------------------------------------------

  protected title(widget: WidgetPublicConfig): string {
    if (this.view() === 'home') {
      const first = (this.session()?.name ?? '').trim().split(' ')[0];
      const greeting = widget.greeting?.trim();
      if (greeting) return first ? `${greeting} ${first}` : greeting;
      return first ? `Hello ${first}` : widget.name;
    }
    if (this.view() === 'details') return widget.name;
    return this.thread()?.agentName ?? widget.name;
  }

  protected subtitle(widget: WidgetPublicConfig): string | null {
    if (this.view() === 'home') return widget.tagline;
    if (this.view() === 'thread') return this.thread()?.subject ?? null;
    return null;
  }

  // ---- Polling -------------------------------------------------------------
  // The documented fallback for the SignalR hub (plan § 10, phase 3). The list
  // polls even while the panel is closed, because that is what feeds the
  // launcher's badge; the thread only polls while it is the view on screen.

  private startPolling(): void {
    const list = setInterval(() => void this.reloadList(), LIST_POLL_MS);
    const thread = setInterval(() => {
      if (this.view() === 'thread' && this.activeId() && this.bridge.visible()) {
        void this.reloadThread();
      }
    }, THREAD_POLL_MS);

    inject(DestroyRef).onDestroy(() => {
      clearInterval(list);
      clearInterval(thread);
    });
  }
}

