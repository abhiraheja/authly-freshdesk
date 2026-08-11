import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
    ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  settled,
  STATUS_TONE,
  SessionStore,
  TicketsApi,
  errorMessage,
  formatDateTime,
  toneFor,
  valueOr,
  type Attachment,
  type Comment,
} from '@trackly/core';
import {
  Alert,
  AttachmentList,
  Avatar,
  Badge,
  Button,
  Card,
  FilePicker,
  Icon,
  InputDirective,
  LabelDirective,
  RichTextView,
  SkeletonDirective,
  Spinner,
  ToastService,
  type AttachmentItem,
} from '@trackly/ui';

/**
 * One of the customer's own tickets: the conversation, and the box to answer in.
 *
 * **Private notes are not filtered here.** The API returns only what a customer
 * is allowed to see — internal comments and their attachments never reach this
 * screen (invariant 5). A filter in the template would be a second, weaker copy
 * of that rule, and the day the two disagreed the UI would be the one that was
 * wrong.
 *
 * The thread reads as a conversation rather than a ticket log: their messages on
 * the right, the desk's on the left with the workspace's colour behind them. The
 * original description is the first message, because to the person who wrote it
 * that is exactly what it was.
 */
@Component({
  selector: 'tk-portal-ticket-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    AttachmentList,
    Avatar,
    Badge,
    Button,
    Card,
    FilePicker,
    Icon,
    InputDirective,
    LabelDirective,
    RichTextView,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <a
      class="mb-4 inline-flex items-center gap-1.5 text-body font-semibold text-muted-foreground hover:text-foreground"
      routerLink="/portal"
    >
      <tk-icon name="arrow-left" [size]="16" />
      {{ 'portal.tickets.title' | transloco }}
    </a>

    @if (loadedTicket(); as data) {
      <tk-card flush>
        <header class="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
          <div class="min-w-0">
            <!-- The subject alone in the heading. The reference is what you quote
                 on a phone call, not what you read the ticket by, so it sits in
                 the meta line with the other facts instead of competing with the
                 one sentence that says what this is about. -->
            <h1 class="truncate text-section font-bold">{{ data.subject }}</h1>
            <p class="mt-1 flex flex-wrap items-center gap-x-1.5 text-meta text-muted-foreground">
              <span class="font-mono">#{{ number() }}</span>
              <span aria-hidden="true">·</span>
              {{ 'portal.detail.opened' | transloco: { when: opened() } }}
              @if (data.category; as category) {
                <span aria-hidden="true">·</span>
                {{ category.name }}
              }
            </p>
          </div>
          @let tone = statusTone();
          <tk-badge [tone]="tone.tone" dot>{{ data.statusName || (tone.labelKey | transloco) }}</tk-badge>
        </header>

        <!-- What the desk decided, in the words written for them to read. The
             agent-only resolution note is never sent to this surface. -->
        @if (data.resolutionSummary; as summary) {
          <div class="border-b border-border px-5 py-4">
            <tk-alert tone="success" [heading]="'portal.detail.resolution' | transloco">{{ summary }}</tk-alert>
          </div>
        }

        <!-- The conversation. Every message is avatar + column, and the column's
             align-items is what makes a bubble shrink to its content — as a plain
             block a two-word reply came out as a full-width wall. -->
        <div class="space-y-5 bg-muted px-5 py-6 sm:px-6">
          <!-- The request itself, as the customer's first message: to the person
               who wrote it, that is exactly what it was. -->
          <article class="flex flex-row-reverse gap-3">
            <tk-avatar
              [name]="myName()"
              [imageUrl]="myAvatar()"
              [size]="34"
              class="mt-5 shrink-0"
            />
            <div class="flex min-w-0 flex-1 flex-col items-end">
              <p class="mb-1.5 text-meta text-muted-foreground">
                <span class="font-semibold text-foreground">{{ 'portal.detail.you' | transloco }}</span>
                · {{ when(data.createdAt) }}
              </p>
              <div class="max-w-full rounded-2xl rounded-tr-md border border-transparent bg-accent px-4 py-3 sm:max-w-[34rem]">
                <p class="whitespace-pre-wrap text-body">{{ data.description }}</p>
                <tk-attachment-list [items]="ticketAttachments()" />
              </div>
            </div>
          </article>

          @for (comment of comments(); track comment.id) {
            @let mine = isMine(comment);
            <article class="flex gap-3" [class.flex-row-reverse]="mine">
              <tk-avatar
                [name]="mine ? myName() : authorName(comment)"
                [imageUrl]="mine ? myAvatar() : (comment.author?.avatarUrl ?? null)"
                [size]="34"
                class="mt-5 shrink-0"
              />
              <div class="flex min-w-0 flex-1 flex-col" [class.items-end]="mine" [class.items-start]="!mine">
                <p class="mb-1.5 flex flex-wrap items-center gap-x-1.5 text-meta text-muted-foreground">
                  <span class="font-semibold text-foreground">
                    {{ mine ? ('portal.detail.you' | transloco) : authorName(comment) }}
                  </span>
                  <!-- Says who is answering without naming a department or a
                       queue: to the customer the desk is one thing. -->
                  @if (!mine) {
                    <span class="rounded-full bg-primary px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-primary-foreground">
                      {{ 'portal.detail.team' | transloco }}
                    </span>
                  }
                  <span aria-hidden="true">·</span>
                  {{ when(comment.createdAt) }}
                </p>
                <!-- 34rem caps a paragraph at roughly the 70 characters an eye can
                     track back from; the tail radius points at whoever wrote it. -->
                <div
                  class="max-w-full px-4 py-3 sm:max-w-[34rem]"
                  [class]="mine ? 'rounded-2xl rounded-tr-md border border-transparent bg-accent' : 'rounded-2xl rounded-tl-md border border-border bg-card'"
                >
                  <tk-rich-text [value]="comment.body" [format]="comment.bodyFormat" />
                  <tk-attachment-list [items]="attachmentsOf(comment)" />
                </div>
              </div>
            </article>
          }

          @if (commentList.isLoading() && !loadedCommentList()) {
            <div class="flex gap-3">
              <span tkSkeleton class="mt-5 size-[34px] shrink-0 rounded-full"></span>
              <span tkSkeleton class="block h-16 w-2/3 rounded-2xl"></span>
            </div>
          }
        </div>

        <!-- Replying reopens nothing by itself; the desk decides what a new
             message does to a resolved ticket. So the box stays available. -->
        <div class="border-t border-border px-5 py-4 sm:px-6">
          <label tkLabel for="reply">{{ 'portal.detail.replyLabel' | transloco }}</label>
          <textarea
            tkInput
            inset
            id="reply"
            rows="3"
            [placeholder]="'portal.detail.replyPlaceholder' | transloco"
            [disabled]="sending()"
            [(ngModel)]="reply"
          ></textarea>

          <div class="mt-3 flex flex-wrap items-center gap-3">
            <tk-file-picker
              variant="inline"
              multiple
              [(files)]="files"
              [accept]="attachmentAccept"
              [maxBytes]="maxUploadBytes"
              [disabled]="sending()"
              [progress]="uploadProgress()"
              [label]="'portal.detail.attach' | transloco"
            />
            <button tkButton class="ml-auto shrink-0" [disabled]="!canSend()" (click)="send()">
              @if (sending()) {
                <tk-spinner [size]="16" />
              } @else {
                <tk-icon name="send" [size]="16" />
              }
              {{ 'portal.detail.send' | transloco }}
            </button>
          </div>

          @if (sendError(); as message) {
            <div class="mt-3">
              <tk-alert tone="danger" [heading]="'portal.detail.sendFailed' | transloco">{{ message }}</tk-alert>
            </div>
          }
        </div>
      </tk-card>
    } @else if (ticket.error()) {
      <tk-alert tone="danger" [heading]="'portal.detail.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="ticket.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <span tkSkeleton class="block h-[420px] w-full rounded-2xl"></span>
    }
  `,
})
export class PortalTicketDetail {
  private readonly api = inject(TicketsApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(ToastService);

  /** Route param, bound by `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  protected readonly reply = signal('');
  protected readonly files = signal<File[]>([]);
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);
  protected readonly uploadProgress = signal<number | null>(null);

  protected readonly maxUploadBytes = MAX_ATTACHMENT_BYTES;
  protected readonly attachmentAccept = ATTACHMENT_ACCEPT;

  protected readonly ticket = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.get(params.id),
  });

  protected readonly commentList = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.comments(params.id),
  });

  private readonly attachments = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.api.attachments(params.id),
  });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedTicket = settled(() => this.ticket);
  protected readonly loadedCommentList = settled(() => this.commentList);

  /**
   * `valueOr` on both: the thread is worth reading even if one of the two
   * secondary lists failed, and a throwing `value()` inside a template takes the
   * whole page down rather than the part that failed.
   */
  protected readonly comments = computed(() => valueOr(this.commentList, [] as Comment[]));

  protected readonly loadError = computed(() => errorMessage(this.ticket.error()));

  protected readonly ticketAttachments = computed(() =>
    this.toItems(valueOr(this.attachments, [] as Attachment[]).filter((file) => file.commentId === null)),
  );

  /**
   * Built once per comment load rather than per call: a method returning a fresh
   * array hands the list a new reference on every change-detection pass, and a
   * signal input reads that as a change.
   */
  private readonly commentAttachments = computed(() => {
    const byComment = new Map<string, AttachmentItem[]>();
    for (const comment of this.comments()) byComment.set(comment.id, this.toItems(comment.attachments));
    return byComment;
  });

  protected readonly canSend = computed(() => !this.sending() && this.reply().trim().length > 0);

  /** Their own face on their own side of the thread. */
  protected readonly myName = computed(() => this.session.displayName());
  protected readonly myAvatar = computed(() => this.session.user()?.avatarUrl ?? null);

  protected attachmentsOf(comment: Comment): AttachmentItem[] {
    return this.commentAttachments().get(comment.id) ?? [];
  }

  protected statusTone() {
    return toneFor(STATUS_TONE, this.loadedTicket()?.statusCategory);
  }

  protected number(): string {
    return this.id().slice(0, 8);
  }

  protected opened(): string {
    const created = this.loadedTicket()?.createdAt;
    return created ? formatDateTime(created) : '';
  }

  protected when(iso: string): string {
    return formatDateTime(iso);
  }

  protected isMine(comment: Comment): boolean {
    return comment.author?.id === this.session.user()?.id;
  }

  /** Falls back to the workspace's side of the conversation, never to "unknown". */
  protected authorName(comment: Comment): string {
    return comment.author?.name || comment.author?.email || comment.guestEmail || '';
  }

  /**
   * Posts the reply, then its files.
   *
   * `isInternal: false` is not a choice this screen offers — a customer has no
   * private side of their own ticket, and the server would refuse it anyway.
   */
  protected async send(): Promise<void> {
    if (!this.canSend()) return;

    this.sending.set(true);
    this.sendError.set(null);
    try {
      const comment = await this.api.addComment(this.id(), {
        body: this.reply().trim(),
        isInternal: false,
      });

      for (const file of this.files()) {
        try {
          await this.api.uploadAttachment(this.id(), file, comment.id, (progress) =>
            this.uploadProgress.set(progress.percent),
          );
        } catch (uploadError) {
          this.toast.warning(errorMessage(uploadError));
        }
      }

      this.reply.set('');
      this.files.set([]);
      this.uploadProgress.set(null);
      this.commentList.reload();
      this.attachments.reload();
    } catch (error) {
      this.sendError.set(errorMessage(error));
    } finally {
      this.sending.set(false);
    }
  }

  private toItems(files: readonly Attachment[]): AttachmentItem[] {
    return files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      url: this.api.attachmentUrl(file.id),
    }));
  }
}
