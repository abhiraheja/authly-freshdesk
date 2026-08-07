import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  MAX_ATTACHMENT_BYTES,
  PRIORITY_TONE,
  STATUS_TONE,
  SessionStore,
  TicketsApi,
  errorMessage,
  formatBytes,
  formatDateTime,
  timeAgo,
  toneFor,
  type Attachment,
  type Comment,
  type UpdateTicketBody,
} from '@trackly/core';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  FilePicker,
  Icon,
  InputDirective,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  Tabs,
  ToastService,
  type IconName,
  type TabItem,
} from '@trackly/ui';
import { TicketDetailPanel } from './ticket-detail-panel';

/** Channel → icon, matching the ticket list so the same source reads the same. */
const CHANNEL_ICON: Record<string, IconName> = {
  email: 'mail',
  chat: 'messages-square',
  whatsapp: 'message-circle',
  voice: 'phone',
  phone: 'phone',
  api: 'code',
  widget: 'globe',
  web: 'globe',
  form: 'globe',
  manual: 'pencil',
};


/**
 * The ticket view: conversation on the left, properties on the right.
 *
 * **Private notes are styled, not gated, here.** `GET /comments` already strips
 * internal notes for anyone who shouldn't see them (invariant 5) — the amber
 * treatment and the lock icon are a second signal for the agent about to type,
 * never the control. Nothing in this file decides who sees what.
 *
 * The React original was a full-screen three-pane workspace with its own icon
 * rail. This is two panes inside the app shell instead: the third pane was a
 * ticket list, which is a route away and was costing a permanent third of the
 * screen to duplicate.
 */
@Component({
  selector: 'tk-ticket-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    RouterLink,
    Alert,
    Avatar,
    Badge,
    Button,
    Card,
    FilePicker,
    Icon,
    InputDirective,
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
    Tabs,
    TicketDetailPanel,
  ],
  template: `
    <a
      class="mb-4 inline-flex items-center gap-1.5 text-body font-semibold text-muted-foreground hover:text-foreground"
      routerLink="/dashboard/tickets"
    >
      <tk-icon name="arrow-left" [size]="16" />
      {{ 'tickets.title' | transloco }}
    </a>

    <!-- Value FIRST, skeleton last. isLoading() is also true during a
         reload, so checking it first swaps the whole screen for a skeleton
         every time a property changes — which destroys this subtree and every
         piece of state inside it, including an open dialog the agent was
         halfway through filling in. The skeleton is for the first load only,
         which is exactly "there is no value yet". -->
    @if (ticket.value(); as data) {
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="min-w-0 space-y-4">
          <!-- Header: identity chips first, then the subject. The chips answer
               "what am I looking at" in one glance; the subject answers "about
               what", and it is the longer read. -->
          <tk-card>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <span class="font-mono text-meta font-bold text-primary">#{{ data.id.slice(0, 8) }}</span>
                  <tk-badge [tone]="statusTone().tone" dot>{{ statusTone().labelKey | transloco }}</tk-badge>
                  <tk-badge [tone]="priorityTone().tone">{{ priorityTone().labelKey | transloco }}</tk-badge>
                  <span class="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
                    <tk-icon [name]="channelIcon()" [size]="14" />
                    {{ data.channel }}
                  </span>
                </div>
                <h1 class="font-display text-section font-extrabold">{{ data.subject }}</h1>
                <p class="mt-1 text-meta text-muted-foreground">
                  {{ 'tickets.detail.openedBy' | transloco: { name: requesterName(), time: opened() } }}
                </p>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <tk-select
                  auto
                  inset
                  size="sm"
                  [ariaLabel]="'tickets.columns.status' | transloco"
                  [value]="data.status"
                  (valueChange)="update({ status: $event })"
                >
                  <tk-option value="open" [label]="'status.open' | transloco" />
                  <tk-option value="pending" [label]="'status.pending' | transloco" />
                  <tk-option value="resolved" [label]="'status.resolved' | transloco" />
                  <tk-option value="closed" [label]="'status.closed' | transloco" />
                </tk-select>
                <!-- Hidden once it is resolved rather than disabled: a dead
                     button invites clicking, and the status select right beside
                     it can already move it back. -->
                @if (data.status !== 'resolved' && data.status !== 'closed') {
                  <button tkButton variant="success" size="sm" (click)="update({ status: 'resolved' })">
                    <tk-icon name="check" [size]="16" />
                    {{ 'tickets.detail.resolve' | transloco }}
                  </button>
                }
              </div>
            </div>
          </tk-card>

          <tk-card flush>
            <div class="px-4 pt-3">
              <tk-tabs [tabs]="threadTabs()" [active]="threadTab()" (activeChange)="setThreadTab($event)" panelId="thread-panel" />
            </div>

            <!-- The description is the first message: it is what the customer
                 wrote, so pulling it out of the thread would break the
                 chronology. It belongs to the Conversation tab only. -->
            <div id="thread-panel" role="tabpanel" class="space-y-3 p-4">
              @switch (threadTab()) {
                @case ('attachments') {
                  @for (file of allAttachments(); track file.id) {
                    <a class="attachment-row" [href]="url(file)" target="_blank" rel="noopener">
                      <tk-icon name="paperclip" [size]="16" class="shrink-0 text-muted-foreground" />
                      <span class="min-w-0 flex-1 truncate font-semibold">{{ file.fileName }}</span>
                      <span class="shrink-0 text-meta text-muted-foreground">{{ size(file) }}</span>
                    </a>
                  } @empty {
                    <p class="py-6 text-center text-body text-muted-foreground">
                      {{ 'tickets.detail.noAttachments' | transloco }}
                    </p>
                  }
                }

                @default {
                  @if (threadTab() === 'conversation') {
                    <article class="flex gap-3">
                      <tk-avatar
                        [name]="requesterName()"
                        [imageUrl]="data.requester?.avatarUrl ?? null"
                        [size]="34"
                        class="mt-0.5 shrink-0"
                      />
                      <div class="min-w-0 flex-1">
                        <p class="mb-1 text-meta text-muted-foreground">
                          <span class="font-semibold text-foreground">{{ requesterName() }}</span>
                          · {{ createdAt() }}
                        </p>
                        <div class="rounded-2xl rounded-tl-sm border border-border bg-card p-4">
                          <p class="whitespace-pre-wrap text-body">{{ data.description }}</p>
                          @for (file of ticketAttachments(); track file.id) {
                            <a class="attachment-chip" [href]="url(file)" target="_blank" rel="noopener">
                              <tk-icon name="paperclip" [size]="14" />
                              {{ file.fileName }} · {{ size(file) }}
                            </a>
                          }
                        </div>
                      </div>
                    </article>
                  }

                  @for (comment of visibleComments(); track comment.id) {
                    <article class="flex gap-3" [class.flex-row-reverse]="fromTeam(comment)">
                      <tk-avatar
                        [name]="authorName(comment)"
                        [imageUrl]="comment.author?.avatarUrl ?? null"
                        [size]="34"
                        class="mt-0.5 shrink-0"
                      />
                      <div class="min-w-0 flex-1">
                        <p class="mb-1 text-meta text-muted-foreground" [class.text-right]="fromTeam(comment)">
                          @if (comment.isInternal) {
                            <span class="font-semibold text-warning-ink">
                              <tk-icon name="lock" [size]="12" class="inline align-[-1px]" />
                              {{ 'tickets.detail.internalNote' | transloco }} ·
                            </span>
                          }
                          <span class="font-semibold text-foreground">{{ authorName(comment) }}</span>
                          @if (isMine(comment)) {
                            <span>({{ 'tickets.detail.you' | transloco }})</span>
                          }
                          · {{ at(comment) }}
                        </p>
                        <div class="rounded-2xl border p-4" [class]="bubbleClass(comment)">
                          <p class="whitespace-pre-wrap text-body" [class.text-white]="isAgentReply(comment)">
                            {{ comment.body }}
                          </p>
                          @for (file of comment.attachments; track file.id) {
                            <a class="attachment-chip" [href]="url(file)" target="_blank" rel="noopener">
                              <tk-icon name="paperclip" [size]="14" />
                              {{ file.fileName }} · {{ size(file) }}
                            </a>
                          }
                        </div>
                      </div>
                    </article>
                  } @empty {
                    @if (!comments.isLoading() && threadTab() === 'notes') {
                      <p class="py-6 text-center text-body text-muted-foreground">
                        {{ 'tickets.detail.noNotes' | transloco }}
                      </p>
                    }
                  }

                  @if (comments.isLoading()) {
                    <div class="flex items-center gap-2 text-body text-muted-foreground">
                      <tk-spinner [size]="16" />
                      {{ 'common.loading' | transloco }}
                    </div>
                  }
                }
              }
            </div>
          </tk-card>

          <!-- Composer -->
          <tk-card>
            <div class="mb-3 flex gap-1">
              <button
                type="button"
                class="composer-tab"
                [class.is-active]="mode() === 'reply'"
                [attr.aria-pressed]="mode() === 'reply'"
                (click)="mode.set('reply')"
              >
                <tk-icon name="message-square" [size]="15" />
                {{ 'tickets.detail.publicReply' | transloco }}
              </button>
              <button
                type="button"
                class="composer-tab composer-tab-note"
                [class.is-active]="mode() === 'note'"
                [attr.aria-pressed]="mode() === 'note'"
                (click)="mode.set('note')"
              >
                <tk-icon name="lock" [size]="15" />
                {{ 'tickets.detail.privateNote' | transloco }}
              </button>
            </div>

            <textarea
              tkInput
              inset
              rows="4"
              [attr.aria-label]="composerPlaceholder()"
              [placeholder]="composerPlaceholder()"
              [(ngModel)]="body"
            ></textarea>

            @if (sendError(); as message) {
              <tk-alert tone="danger" class="mt-3">{{ message }}</tk-alert>
            }

            <div class="mt-3 flex items-end justify-between gap-3">
              <!-- Inline variant: in a composer the picker is one action among
                   several, so it reads as a button rather than taking a
                   dropzone's worth of vertical space above the Send button. -->
              <tk-file-picker
                class="min-w-0 flex-1"
                variant="inline"
                multiple
                [(files)]="files"
                [maxBytes]="maxUploadBytes"
                [disabled]="sending()"
                [progress]="uploadProgress()"
                [label]="'tickets.detail.attach' | transloco"
              />
              <button tkButton class="shrink-0" [disabled]="!body().trim() || sending()" (click)="send()">
                @if (sending()) {
                  <tk-spinner [size]="16" />
                } @else {
                  <tk-icon name="send" [size]="16" />
                }
                {{ (mode() === 'reply' ? 'tickets.detail.sendReply' : 'tickets.detail.addNote') | transloco }}
              </button>
            </div>
          </tk-card>
        </div>

        <tk-ticket-detail-panel
          [ticket]="data"
          [meId]="meId()"
          (assignToMe)="assignSelf()"
          (watchMe)="watchSelf()"
          (escalate)="escalate()"
          (change)="update($event)"
          (tagsChange)="setTags($event)"
          (watch)="addWatcher($event)"
          (unwatch)="removeWatcher($event)"
        />
      </div>
    } @else if (ticket.error()) {
      <tk-alert tone="danger" [heading]="'tickets.detail.loadFailed' | transloco">
        {{ errorText() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="ticket.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <div class="space-y-4">
        <span tkSkeleton class="h-7 w-2/3"></span>
        <span tkSkeleton class="h-4 w-40"></span>
        <span tkSkeleton class="h-40 w-full"></span>
      </div>
    }
  `,
})
export class TicketDetail {
  private readonly api = inject(TicketsApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(ToastService);

  /** Route param, bound by `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  protected readonly ticket = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.get(params.id),
  });

  protected readonly comments = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.comments(params.id),
  });

  private readonly attachments = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.attachments(params.id),
  });

  private readonly transloco = inject(TranslocoService);
  /** Re-resolve the TS-side tab labels when the language changes. */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  protected readonly threadTab = signal<'conversation' | 'notes' | 'attachments'>('conversation');
  protected readonly mode = signal<'reply' | 'note'>('reply');
  protected readonly body = signal('');
  protected readonly files = signal<File[]>([]);
  protected readonly maxUploadBytes = MAX_ATTACHMENT_BYTES;
  protected readonly uploadProgress = signal<number | null>(null);
  protected readonly sendError = signal<string | null>(null);
  protected readonly sending = signal(false);

  protected readonly errorText = computed(() => errorMessage(this.ticket.error()));

  protected readonly statusTone = computed(() => toneFor(STATUS_TONE, this.ticket.value()?.status));
  protected readonly priorityTone = computed(() => toneFor(PRIORITY_TONE, this.ticket.value()?.priority));
  protected readonly channelIcon = computed(
    () => CHANNEL_ICON[this.ticket.value()?.channel?.toLowerCase() ?? ''] ?? 'globe',
  );

  /**
   * Internal notes get their own tab as well as appearing inline. Agents scan
   * for "what did we decide internally" separately from "what did we tell the
   * customer", and hunting amber bubbles out of a long thread is the slow way.
   */
  protected readonly visibleComments = computed(() => {
    const all = this.comments.value() ?? [];
    if (this.threadTab() === 'notes') return all.filter((comment) => comment.isInternal);
    return all;
  });

  protected readonly allAttachments = computed(() => this.attachments.value() ?? []);

  protected readonly threadTabs = computed<TabItem[]>(() => {
    this.lang();
    const notes = (this.comments.value() ?? []).filter((comment) => comment.isInternal).length;
    return [
      { id: 'conversation', label: this.transloco.translate('tickets.detail.tabConversation') },
      { id: 'notes', label: this.transloco.translate('tickets.detail.tabNotes'), count: notes || undefined },
      {
        id: 'attachments',
        label: this.transloco.translate('tickets.detail.tabAttachments'),
        count: this.allAttachments().length || undefined,
      },
    ];
  });

  /** Only files hung off the ticket itself; a comment renders its own. */
  protected readonly ticketAttachments = computed(() =>
    (this.attachments.value() ?? []).filter((file) => file.commentId === null),
  );

  protected readonly requesterName = computed(() => {
    const t = this.ticket.value();
    return t?.requester?.name || t?.requester?.email || t?.guestName || t?.guestEmail || 'Guest';
  });

  protected readonly opened = computed(() => timeAgo(this.ticket.value()?.createdAt ?? ''));
  protected readonly createdAt = computed(() => formatDateTime(this.ticket.value()?.createdAt ?? ''));
  protected readonly composerPlaceholder = computed(() =>
    this.mode() === 'reply'
      ? `Reply to ${this.requesterName()}… (the customer will see this)`
      : 'Private note… (only agents and admins can see this)',
  );

  /** Tabs emit a plain string; narrow it here rather than widening the signal. */
  protected setThreadTab(tab: string): void {
    if (tab === 'conversation' || tab === 'notes' || tab === 'attachments') this.threadTab.set(tab);
  }

  protected fromTeam(comment: Comment): boolean {
    return comment.author?.role === 'agent' || comment.author?.role === 'admin';
  }

  protected isMine(comment: Comment): boolean {
    return comment.author?.id === this.session.user()?.id;
  }

  protected authorName(comment: Comment): string {
    return comment.author?.name || comment.author?.email || comment.guestEmail || 'Guest';
  }

  protected at(comment: Comment): string {
    return formatDateTime(comment.createdAt);
  }

  /**
   * Static lookup, never an interpolated class name — a template string like
   * `border-${tone}` emits no CSS at all under Tailwind v4 and fails silently.
   */
  /** A public reply from the team — the only bubble that inverts. */
  protected isAgentReply(comment: Comment): boolean {
    return this.fromTeam(comment) && !comment.isInternal;
  }

  protected bubbleClass(comment: Comment): string {
    if (comment.isInternal) return 'rounded-tr-sm border-dashed border-warning/50 bg-warning/10';
    return this.isAgentReply(comment)
      ? 'rounded-tr-sm border-transparent bg-primary'
      : 'rounded-tl-sm border-border bg-card';
  }

  protected url(file: Attachment): string {
    return this.api.attachmentUrl(file.id);
  }

  protected size(file: Attachment): string {
    return formatBytes(file.sizeBytes);
  }

  /**
   * The comment is posted first because an attachment has to hang off one. If
   * the upload then fails the comment is already public — so it warns and keeps
   * the comment rather than reporting a failure that would have the agent
   * retype and double-post.
   */
  protected async send(): Promise<void> {
    const body = this.body().trim();
    if (!body || this.sending()) return;

    this.sending.set(true);
    this.sendError.set(null);
    try {
      const comment = await this.api.addComment(this.id(), { body, isInternal: this.mode() === 'note' });

      // One at a time, so the bar tracks a single file and a slow connection
      // isn't split five ways. A failure warns per file and the rest continue.
      for (const file of this.files()) {
        try {
          await this.api.uploadAttachment(this.id(), file, comment.id, (p) =>
            this.uploadProgress.set(p.percent),
          );
        } catch (uploadError) {
          this.toast.warning(errorMessage(uploadError));
        }
      }
      this.uploadProgress.set(null);

      this.body.set('');
      this.files.set([]);
      this.comments.reload();
      this.attachments.reload();
      this.ticket.reload();
    } catch (error) {
      this.sendError.set(errorMessage(error));
    } finally {
      this.sending.set(false);
    }
  }

  protected readonly meId = computed(() => this.session.user()?.id ?? null);

  protected assignSelf(): void {
    const me = this.meId();
    if (me) void this.update({ assigneeId: me });
  }

  protected watchSelf(): void {
    const me = this.meId();
    if (me) void this.addWatcher(me);
  }

  /**
   * Escalate = raise to the highest configured priority. Defined here rather
   * than server-side because it is a shorthand for an existing edit, not a new
   * concept — nothing about the ticket changes that a priority change wouldn't.
   */
  protected async escalate(): Promise<void> {
    const options = await this.api.ticketOptions('priority');
    const top = options.at(-1);
    if (top && top.value !== this.ticket.value()?.priority) {
      await this.update({ priority: top.value });
    }
  }

  protected async update(body: UpdateTicketBody): Promise<void> {
    await this.write(() => this.api.update(this.id(), body));
  }

  protected async setTags(tags: string[]): Promise<void> {
    await this.write(() => this.api.setTags(this.id(), tags));
  }

  protected async addWatcher(agentId: string): Promise<void> {
    if (!agentId) return;
    await this.write(() => this.api.addWatcher(this.id(), agentId));
  }

  protected async removeWatcher(agentId: string): Promise<void> {
    await this.write(() => this.api.removeWatcher(this.id(), agentId));
  }

  /**
   * Reload rather than patch the local copy: the server runs automation and SLA
   * on every change, so a status flip can also move the due dates and the
   * assignee. Trusting the local guess would show a ticket that never existed.
   */
  private async write(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      this.ticket.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
      // Put the controls back to the server's truth — they are bound to the
      // resource, so a failed write must not leave the UI showing the attempt.
      this.ticket.reload();
    }
  }
}
