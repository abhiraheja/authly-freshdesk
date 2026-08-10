import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  PRIORITY_TONE,
  STATUS_TONE,
  SessionStore,
  TicketsApi,
  errorMessage,
  formatDateTime,
  isTerminalCategory,
  timeAgo,
  toneFor,
  valueOr,
  type Attachment,
  type CannedResponse,
  type Comment,
  type UpdateTicketBody,
} from '@trackly/core';
import {
  Alert,
  AttachmentList,
  Avatar,
  Badge,
  Button,
  Card,
  Dropdown,
  Editor,
  FilePicker,
  Icon,
  RichTextView,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  Tabs,
  ToastService,
  isEmptyHtml,
  textToHtml,
  type AttachmentItem,
  type IconName,
  type MentionCandidate,
  type TabItem,
} from '@trackly/ui';
import { TicketDetailPanel } from './ticket-detail-panel';
import { ResolveDialog, type ResolvePayload } from './resolve-dialog';
import { TicketActivityFeed } from './ticket-activity';
import { TicketRelations } from './ticket-relations';
import { TicketRelationBanner } from './ticket-relation-banner';
import { TicketTasks } from './ticket-tasks';
import { TicketAssets } from './ticket-assets';

/**
 * The tabs above the thread, in the order they are drawn.
 *
 * One list, used to type the signal, to narrow the string the rail emits, and to
 * build the rail itself — three places that would otherwise fall out of step the
 * first time somebody adds a tab and forgets one of them.
 */
const TAB_IDS = ['conversation', 'notes', 'attachments', 'activity', 'related', 'tasks', 'assets'] as const;
type ThreadTab = (typeof TAB_IDS)[number];

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
    AttachmentList,
    Avatar,
    Badge,
    Button,
    Card,
    Dropdown,
    Editor,
    FilePicker,
    Icon,
    RichTextView,
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
    Tabs,
    ResolveDialog,
    TicketActivityFeed,
    TicketRelations,
    TicketRelationBanner,
    TicketTasks,
    TicketAssets,
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
          <!-- Above the header, because it changes whether the header's Resolve
               button is the right next move. Renders nothing when the ticket
               stands alone, which is most of them. -->
          <tk-ticket-relation-banner
            [summary]="data.relations"
            (openRelated)="threadTab.set('related')"
          />
          <!-- Header: identity chips first, then the subject. The chips answer
               "what am I looking at" in one glance; the subject answers "about
               what", and it is the longer read. -->
          <tk-card>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <span class="font-mono text-meta font-bold text-primary">#{{ data.id.slice(0, 8) }}</span>
                  <tk-badge [tone]="statusTone().tone" dot>{{ statusLabel() }}</tk-badge>
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

                <!-- What the ticket is about besides the conversation. The tab
                     counts say how many; these say which kind, and one of them —
                     a service that is DOWN — is a severity no count can carry. -->
                @if (attachedChips().length) {
                  <div class="mt-2 flex flex-wrap items-center gap-1.5">
                    @for (chip of attachedChips(); track chip.key) {
                      <button
                        type="button"
                        class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-meta font-semibold"
                        [class]="chipClass(chip.tone)"
                        (click)="threadTab.set(chip.key === 'responders' ? 'tasks' : 'assets')"
                      >
                        <tk-icon [name]="chip.icon" [size]="13" />
                        {{ chip.labelKey | transloco: { count: chip.count } }}
                      </button>
                    }
                  </div>
                }
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <!-- Pin and flag look alike and are not. The pin is yours: it
                     sorts this to the top of YOUR list and no colleague sees it.
                     The flag is the team's. Kept side by side so the difference
                     is learned once, from the tooltips, rather than guessed. -->
                <!-- The FILL is what makes on/off readable — a solid shape next
                     to an outline is unmistakable, where a colour change on the
                     outline alone was two stroked pixels nobody noticed. The
                     colour is the second signal; the tooltip says what a click
                     will do. No pill, no label: this is a toggle, not an
                     announcement. -->
                <button
                  type="button"
                  class="mark-toggle"
                  [class.is-pin]="data.isPinned"
                  [attr.aria-pressed]="data.isPinned"
                  [title]="(data.isPinned ? 'tickets.pin.unpin' : 'tickets.pin.pin') | transloco"
                  [attr.aria-label]="(data.isPinned ? 'tickets.pin.unpin' : 'tickets.pin.pin') | transloco"
                  [disabled]="marking()"
                  (click)="togglePin(data.isPinned)"
                >
                  <tk-icon name="pin" [size]="17" [filled]="data.isPinned" />
                </button>

                <button
                  type="button"
                  class="mark-toggle"
                  [class.is-flag]="!!data.flaggedAt"
                  [attr.aria-pressed]="!!data.flaggedAt"
                  [title]="flagTitle()"
                  [attr.aria-label]="(data.flaggedAt ? 'tickets.flag.unflag' : 'tickets.flag.flag') | transloco"
                  [disabled]="marking()"
                  (click)="toggleFlag(!!data.flaggedAt)"
                >
                  <tk-icon name="flag" [size]="17" [filled]="!!data.flaggedAt" />
                </button>

                <!-- Only the moves the workflow allows, plus the one it is in.
                     The server refuses anything else, so offering more would be
                     offering a click that fails. -->
                <tk-select
                  auto
                  inset
                  size="sm"
                  [ariaLabel]="'tickets.columns.status' | transloco"
                  [value]="statusValue()"
                  (valueChange)="pickStatus($event)"
                >
                  @for (option of reachable(); track option.id) {
                    <tk-option [value]="option.value" [label]="option.name" />
                  }
                </tk-select>
                <!-- Hidden once the work is over rather than disabled: a dead
                     button invites clicking, and the status select right beside
                     it can already move it back. -->
                @if (!finished()) {
                  <button tkButton variant="success" size="sm" (click)="pickStatus(resolvedValue())">
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
                  @if (allAttachments().length) {
                    <tk-attachment-list [items]="allAttachments()" />
                  } @else {
                    <p class="py-6 text-center text-body text-muted-foreground">
                      {{ 'tickets.detail.noAttachments' | transloco }}
                    </p>
                  }
                }

                <!-- Each panel lives inside the @switch, so it is created when
                     the tab is opened and its fetches never happen for the
                     agents who only ever read the conversation. -->
                @case ('activity') {
                  <tk-ticket-activity [ticketId]="data.id" [version]="activityVersion()" />
                }

                @case ('related') {
                  <tk-ticket-relations
                    [ticketId]="data.id"
                    [linkedProblemId]="data.problemId"
                    (problemChanged)="reloadTicket()"
                  />
                }

                @case ('tasks') {
                  <tk-ticket-tasks [ticketId]="data.id" [agents]="agentList()" />
                }

                @case ('assets') {
                  <tk-ticket-assets [ticketId]="data.id" />
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
                      <div class="flex min-w-0 flex-1 flex-col items-start">
                        <p class="mb-1 text-meta text-muted-foreground">
                          <span class="font-semibold text-foreground">{{ requesterName() }}</span>
                          · {{ createdAt() }}
                        </p>
                        <!-- The description stays plain text: it is written on
                             the submit form, which customers use too. -->
                        <div class="max-w-full rounded-2xl rounded-tl-sm border border-border bg-card p-4 sm:max-w-[42rem]">
                          <p class="whitespace-pre-wrap text-body">{{ data.description }}</p>
                          <tk-attachment-list [items]="ticketAttachments()" />
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
                      <!-- A column flex container, because align-items on one is
                           what makes the bubble shrink to its content. As a
                           plain block the bubble filled the whole width, so a
                           two-word reply came out as a wall of colour. -->
                      <div
                        class="flex min-w-0 flex-1 flex-col"
                        [class.items-end]="fromTeam(comment)"
                        [class.items-start]="!fromTeam(comment)"
                      >
                        <p class="mb-1 text-meta text-muted-foreground" [class.text-right]="fromTeam(comment)">
                          <!-- Two different labels, because they are two
                               different promises. "Team note" means every agent
                               reads it; "Only you" means nobody else does, not
                               even an admin. Showing one word for both is how
                               somebody writes the wrong one. -->
                          @if (comment.visibility === 'private') {
                            <span class="font-semibold text-primary">
                              <tk-icon name="lock" [size]="12" class="inline align-[-1px]" />
                              {{ 'tickets.detail.onlyYou' | transloco }} ·
                            </span>
                          } @else if (comment.isInternal) {
                            <span class="font-semibold text-warning-ink">
                              <tk-icon name="users" [size]="12" class="inline align-[-1px]" />
                              {{ 'tickets.detail.teamNote' | transloco }} ·
                            </span>
                          }
                          <span class="font-semibold text-foreground">{{ authorName(comment) }}</span>
                          @if (isMine(comment)) {
                            <span>({{ 'tickets.detail.you' | transloco }})</span>
                          }
                          · {{ at(comment) }}
                        </p>
                        <!-- Capped so a long paragraph stays readable and a
                             short one stays short. 42rem is roughly the 70–80
                             characters a line can be before the eye loses the
                             next one. -->
                        <div class="max-w-full rounded-2xl border p-4 sm:max-w-[42rem]" [class]="bubbleClass(comment)">
                          <!-- Branches on the stored format, never on what the
                               body looks like: "<3 that fix" is text that reads
                               as markup, and guessing wrong shows a customer a
                               broken tag instead of their own words. -->
                          <tk-rich-text
                            [value]="comment.body"
                            [format]="comment.bodyFormat"
                            [dark]="isAgentReply(comment)"
                          />
                          <tk-attachment-list
                            [items]="attachmentsOf(comment)"
                            [dark]="isAgentReply(comment)"
                          />
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

          <!-- Composer. Only on the two tabs it can write to: Conversation and
               Notes are the thread, and everything the composer produces lands
               there. On Attachments, Activity, Related, Tasks or Assets a reply
               box is an invitation to type into a panel that has nothing to do
               with it — the message would appear on a tab the agent is not
               looking at, which reads as the send having failed. -->
          @if (canCompose()) {
          <tk-card>
            <!-- Three modes, not two. "Private note" used to mean "every agent
                 sees it, the customer does not", which is a shared scratchpad —
                 a genuinely private one had nowhere to live. -->
            <div class="mb-3 flex flex-wrap gap-1">
              <button
                type="button"
                class="composer-tab"
                [class.is-active]="mode() === 'public'"
                [attr.aria-pressed]="mode() === 'public'"
                (click)="mode.set('public')"
              >
                <tk-icon name="message-square" [size]="15" />
                {{ 'tickets.detail.publicReply' | transloco }}
              </button>
              <button
                type="button"
                class="composer-tab composer-tab-note"
                [class.is-active]="mode() === 'internal'"
                [attr.aria-pressed]="mode() === 'internal'"
                (click)="mode.set('internal')"
              >
                <tk-icon name="users" [size]="15" />
                {{ 'tickets.detail.teamNote' | transloco }}
              </button>
              <button
                type="button"
                class="composer-tab composer-tab-note"
                [class.is-active]="mode() === 'private'"
                [attr.aria-pressed]="mode() === 'private'"
                (click)="mode.set('private')"
              >
                <tk-icon name="lock" [size]="15" />
                {{ 'tickets.detail.myNote' | transloco }}
              </button>
            </div>

            <!-- No mentionable list in private mode: a note nobody else reads
                 cannot notify anyone, and offering the picker there would be a
                 control that quietly does nothing. -->
            <tk-editor
              [(value)]="body"
              [rows]="4"
              [labels]="editorLabels()"
              [disabled]="sending()"
              [mentionable]="mentionable()"
              [placeholder]="composerPlaceholder()"
              [ariaLabel]="composerPlaceholder()"
            >
              <!-- display:contents so the wrapper carries the slot attribute
                   without becoming a flex item — the divider and the button end
                   up as direct children of the toolbar, spaced like the rest. -->
              <span editor-tools class="contents">
                <span class="editor-tool-divider" aria-hidden="true"></span>
                <button
                  type="button"
                  class="editor-tool"
                  [disabled]="sending()"
                  [attr.aria-label]="'tickets.detail.attach' | transloco"
                  [title]="'tickets.detail.attach' | transloco"
                  (click)="picker.open()"
                >
                  <tk-icon name="paperclip" [size]="15" />
                </button>

                <!-- Always here, even with nothing in it. This button used to be
                     hidden until the list arrived, which made a workspace with no
                     snippets and a failed request look identical — and both look
                     like the feature does not exist. The menu says which it is. -->
                <tk-dropdown>
                  <button
                    type="button"
                    class="editor-tool"
                    dropdown-trigger
                    [disabled]="sending()"
                    [attr.aria-label]="'tickets.detail.insertCanned' | transloco"
                    [title]="'tickets.detail.insertCanned' | transloco"
                  >
                    <tk-icon name="zap" [size]="15" />
                  </button>
                  <div dropdown-menu class="max-h-80 w-80 overflow-y-auto">
                    @for (snippet of cannedList(); track snippet.id) {
                      <button type="button" class="menu-item block w-full text-left" (click)="insertCanned(snippet)">
                        <span class="block truncate font-semibold">{{ snippet.title }}</span>
                        <span class="block truncate text-meta text-muted-foreground">{{ snippet.body }}</span>
                      </button>
                    } @empty {
                      <p class="px-3 py-2 text-meta text-muted-foreground">
                        {{ (canned.error() ? 'tickets.detail.cannedFailed' : 'tickets.detail.noCanned') | transloco }}
                      </p>
                    }
                    <div class="menu-sep"></div>
                    <a class="menu-item" routerLink="/dashboard/canned">
                      <tk-icon name="pencil" [size]="16" />
                      {{ 'tickets.detail.manageCanned' | transloco }}
                    </a>
                  </div>
                </tk-dropdown>
              </span>
            </tk-editor>

            <!-- Headless: the trigger is the toolbar button above, but the chips
                 belong here rather than in a row of formatting controls. One
                 component still owns the input and the list it fills. -->
            <tk-file-picker
              #picker
              headless
              multiple
              [(files)]="files"
              [accept]="attachmentAccept"
              [maxBytes]="maxUploadBytes"
              [disabled]="sending()"
              [progress]="uploadProgress()"
            />

            @if (sendError(); as message) {
              <tk-alert tone="danger" class="mt-3">{{ message }}</tk-alert>
            }

            <div class="mt-3 flex justify-end">
              <button tkButton class="shrink-0" [disabled]="composerEmpty() || sending()" (click)="send()">
                @if (sending()) {
                  <tk-spinner [size]="16" />
                } @else {
                  <tk-icon name="send" [size]="16" />
                }
                {{ (mode() === 'public' ? 'tickets.detail.sendReply' : 'tickets.detail.addNote') | transloco }}
              </button>
            </div>
          </tk-card>
          }
        </div>

        <!-- The whole rail is one component now, because the workspace decides
             the order of the cards inside it — including Time spent and Related
             work, which own their own data. The version input is how a write
             here tells those two to re-read. -->
        <tk-ticket-detail-panel
          [ticket]="data"
          [meId]="meId()"
          [version]="railVersion()"
          (assignToMe)="assignSelf()"
          (watchMe)="watchSelf()"
          (escalate)="escalate()"
          (change)="update($event)"
          (tagsChange)="setTags($event)"
          (watch)="addWatcher($event)"
          (unwatch)="removeWatcher($event)"
        />
      </div>

      <tk-resolve-dialog
        [(open)]="resolveOpen"
        (openChange)="onResolveClosed($event)"
        [status]="resolveCategory()"
        [saving]="resolveSaving()"
        [error]="resolveError()"
        [preview]="preview.value() ?? null"
        [previewLoading]="preview.isLoading()"
        (confirmed)="applyResolution($event)"
      />
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

  protected readonly threadTab = signal<'conversation' | 'notes' | 'attachments' | 'activity' | 'related' | 'tasks' | 'assets'>('conversation');
  /**
   * Whether the composer belongs on the tab that is open.
   *
   * Conversation and Notes are the two views of the thread, and every mode of
   * the composer writes into it. The other five tabs are side panels with their
   * own inputs — a reply box under them would post somewhere the agent cannot
   * see from where they are standing.
   */
  protected readonly canCompose = computed(
    () => this.threadTab() === 'conversation' || this.threadTab() === 'notes',
  );

  protected readonly mode = signal<'public' | 'internal' | 'private'>('public');
  protected readonly body = signal('');
  protected readonly files = signal<File[]>([]);
  protected readonly maxUploadBytes = MAX_ATTACHMENT_BYTES;
  /** Greys out the wrong files in the OS dialog. The API is what refuses. */
  protected readonly attachmentAccept = ATTACHMENT_ACCEPT;
  protected readonly uploadProgress = signal<number | null>(null);
  protected readonly sendError = signal<string | null>(null);
  protected readonly sending = signal(false);

  protected readonly errorText = computed(() => errorMessage(this.ticket.error()));

  /** Tone comes from the category; the words come from the workspace. */
  protected readonly statusTone = computed(() =>
    toneFor(STATUS_TONE, this.ticket.value()?.statusCategory),
  );
  protected readonly statusLabel = computed(() => this.ticket.value()?.statusName ?? '');

  /** Resolved or closed — the work is over. */
  protected readonly finished = computed(() =>
    isTerminalCategory(this.ticket.value()?.statusCategory ?? ''),
  );

  /**
   * The moves the workflow allows from where the ticket is now, plus the status
   * it is in.
   *
   * Keyed on the ticket's own status so it re-fetches when the status changes —
   * the next set of legal moves depends on where it just landed.
   */
  private readonly reachableStatuses = resource({
    params: () => ({ from: this.ticket.value()?.status ?? '' }),
    loader: ({ params }) =>
      params.from ? this.api.reachableStatuses(params.from) : Promise.resolve([]),
  });

  protected readonly reachable = computed(() => valueOr(this.reachableStatuses, []));

  /** Category of a status value, for deciding whether the resolve dialog opens. */
  private categoryOf(value: string): string {
    return this.reachable().find((s) => s.value === value)?.category ?? '';
  }

  /**
   * The status select's value, owned here rather than read off the resource.
   *
   * `tk-select` sets its own model when an option is picked, so binding the
   * resource straight in leaves no way to put the old value back when someone
   * cancels the confirmation — the bound expression would never have changed,
   * and Angular skips a write that looks identical to the last one.
   */
  protected readonly statusValue = signal('');

  protected readonly resolveOpen = signal(false);

  /**
   * What resolving this ticket would carry with it, and what is still outstanding.
   *
   * Keyed on the dialog being open, so a ticket nobody is resolving costs nothing.
   * It does mean the dialog appears a beat before its warnings do — hence
   * `previewLoading`, which says "still checking" rather than letting the dialog
   * imply for a moment that everything is clear.
   *
   * The API re-checks all of it on the PATCH and answers 409 if it was not
   * acknowledged, so a failed or skipped preview cannot let anything through.
   */
  protected readonly preview = resource({
    params: () => ({ id: this.id(), open: this.resolveOpen() }),
    loader: ({ params }) =>
      params.open ? this.api.resolvePreview(params.id) : Promise.resolve(undefined),
  });
  /**
   * The status the Resolve button moves to: the first reachable one in the
   * resolved category.
   *
   * A button labelled Resolve that sent the literal word "resolved" would 400
   * the moment a workspace renamed or replaced that status — which is the whole
   * point of letting them.
   */
  protected readonly resolvedValue = computed(
    () => this.reachable().find((status) => status.category === 'resolved')?.value ?? '',
  );

  /** The status VALUE being moved to — a workspace name, not one of two words. */
  protected readonly resolveTo = signal('');
  /** Its category, which is what decides the dialog's wording. */
  protected readonly resolveCategory = signal<'resolved' | 'closed'>('resolved');
  protected readonly resolveSaving = signal(false);
  protected readonly resolveError = signal<string | null>(null);

  /**
   * Bumped when a write here changed something a self-fetching rail card shows.
   * Resolving does both: it logs the agent's minutes and files their link.
   */
  protected readonly railVersion = signal(0);

  /**
   * Bumped after every write, so the Activity tab is current whenever it is
   * opened. Separate from railVersion: that one refetches three cards and is
   * only worth it when something they show actually moved, while this is one
   * request that has to reflect literally any change.
   */
  protected readonly activityVersion = signal(0);
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

  protected readonly allAttachments = computed(() => this.toItems(this.attachments.value() ?? []));

  protected readonly threadTabs = computed<TabItem[]>(() => {
    this.lang();
    const notes = (this.comments.value() ?? []).filter((comment) => comment.isInternal).length;
    const ticket = this.ticket.value();
    return [
      { id: 'conversation', label: this.transloco.translate('tickets.detail.tabConversation') },
      { id: 'notes', label: this.transloco.translate('tickets.detail.tabNotes'), count: notes || undefined },
      {
        id: 'attachments',
        label: this.transloco.translate('tickets.detail.tabAttachments'),
        count: this.allAttachments().length || undefined,
      },
      // No count: the activity feed only grows, so the number would be a
      // permanent badge that never means "there is something new for you".
      { id: 'activity', label: this.transloco.translate('tickets.detail.tabActivity'), icon: 'clock' },
      // Counts come off the ticket rather than from each panel's own fetch, so
      // they are correct on first paint. A tab that gains a number a second after
      // the page settles is a tab nobody was looking at when it mattered.
      //
      // Each is `|| undefined` because zero is not a count worth drawing — an
      // empty badge on every tab is noise, and noise is what a badge competes with.
      {
        id: 'related',
        label: this.transloco.translate('tickets.detail.tabRelated'),
        icon: 'link',
        count: ticket?.relations?.total || undefined,
      },
      {
        id: 'tasks',
        label: this.transloco.translate('tickets.detail.tabTasks'),
        icon: 'clipboard-list',
        // OPEN tasks, not all of them: a checklist is read to find what is left,
        // and "8" on a ticket where all eight are ticked is a false alarm.
        count: ticket?.openTaskCount || undefined,
      },
      {
        id: 'assets',
        label: this.transloco.translate('tickets.detail.tabAssets'),
        icon: 'rocket',
        // Assets and impacted services together, because they are one tab.
        count: (ticket?.assetCount ?? 0) + (ticket?.impactedServiceCount ?? 0) || undefined,
      },
    ];
  });

  /**
   * Chips under the subject: what this ticket is *about* besides the conversation.
   *
   * The counts are already on the tabs, so this exists for the one thing a count
   * cannot say — that a service is **down**. That is not a quantity, it is a
   * severity, and it is the difference between a ticket somebody picks up today
   * and one that interrupts a standup.
   */
  protected readonly attachedChips = computed(() => {
    const ticket = this.ticket.value();
    if (!ticket) return [];

    const chips: { key: string; icon: IconName; labelKey: string; count: number; tone: string }[] = [];
    if (ticket.downServiceCount > 0)
      chips.push({
        key: 'down',
        icon: 'octagon-alert',
        labelKey: 'tickets.detail.chips.servicesDown',
        count: ticket.downServiceCount,
        tone: 'danger',
      });
    // Only the ones that are not down, so a single service is never counted twice.
    const degraded = ticket.impactedServiceCount - ticket.downServiceCount;
    if (degraded > 0)
      chips.push({
        key: 'affected',
        icon: 'activity',
        labelKey: 'tickets.detail.chips.servicesAffected',
        count: degraded,
        tone: 'warning',
      });
    if (ticket.assetCount > 0)
      chips.push({
        key: 'assets',
        icon: 'hard-drive',
        labelKey: 'tickets.detail.chips.assets',
        count: ticket.assetCount,
        tone: 'neutral',
      });
    if (ticket.pendingResponderCount > 0)
      chips.push({
        key: 'responders',
        icon: 'user-plus',
        labelKey: 'tickets.detail.chips.respondersPending',
        count: ticket.pendingResponderCount,
        tone: 'info',
      });
    return chips;
  });

  /**
   * Chip tone → classes. A static lookup, because `bg-${tone}/10` emits no CSS at
   * all under Tailwind v4 and fails silently — the most common bug in this
   * codebase.
   */
  protected chipClass(tone: string): string {
    switch (tone) {
      case 'danger':
        return 'bg-danger/10 text-danger hover:bg-danger/15';
      case 'warning':
        return 'bg-warning/15 text-warning-ink hover:bg-warning/25';
      case 'info':
        return 'bg-info/10 text-info hover:bg-info/15';
      default:
        return 'bg-muted text-muted-foreground hover:bg-accent';
    }
  }

  /** Only files hung off the ticket itself; a comment renders its own. */
  protected readonly ticketAttachments = computed(() =>
    this.toItems((this.attachments.value() ?? []).filter((file) => file.commentId === null)),
  );

  /**
   * Built once per comment load, not per call.
   *
   * A method returning a fresh array would hand the list a new reference on
   * every change-detection pass, and a signal input treats that as a change —
   * so the thumbnails would be re-evaluated continuously while anything else on
   * the page ticked.
   */
  private readonly commentAttachments = computed(() => {
    const byComment = new Map<string, AttachmentItem[]>();
    for (const comment of this.comments.value() ?? [])
      byComment.set(comment.id, this.toItems(comment.attachments));
    return byComment;
  });

  protected attachmentsOf(comment: Comment): AttachmentItem[] {
    return this.commentAttachments().get(comment.id) ?? [];
  }

  constructor() {
    // The server is the authority on status: automation can move a ticket on
    // its own, and a failed write reloads. Either way the select follows.
    effect(() => {
      const status = this.ticket.value()?.status;
      if (status) this.statusValue.set(status);
    });
  }

  /** The API shape plus the URL, which only this feature knows how to build. */
  private toItems(files: readonly Attachment[]): AttachmentItem[] {
    return files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      url: this.api.attachmentUrl(file.id),
    }));
  }

  protected readonly requesterName = computed(() => {
    const t = this.ticket.value();
    return t?.requester?.name || t?.requester?.email || t?.guestName || t?.guestEmail || 'Guest';
  });

  protected readonly opened = computed(() => timeAgo(this.ticket.value()?.createdAt ?? ''));
  protected readonly createdAt = computed(() => formatDateTime(this.ticket.value()?.createdAt ?? ''));
  /**
   * Says who will read it, in the field they are about to type into.
   *
   * The three modes look almost identical once you are writing, and the cost of
   * confusing two of them is a private note sent to a customer. The placeholder
   * is the last thing on screen before the first keystroke.
   */
  protected readonly composerPlaceholder = computed(() => {
    this.lang();
    switch (this.mode()) {
      case 'public':
        return this.transloco.translate('tickets.detail.placeholderPublic', {
          name: this.requesterName(),
        });
      case 'internal':
        return this.transloco.translate('tickets.detail.placeholderTeam');
      default:
        return this.transloco.translate('tickets.detail.placeholderPrivate');
    }
  });

  /**
   * Who this composer can name.
   *
   * Empty in private mode — that is how the editor switches mentions off
   * altogether, rather than offering a picker that would notify nobody.
   *
   * **Agents and admins only.** A customer is not mentionable: the notification
   * is agent-facing and being named would hand them a "mentioning me" view of
   * tickets that are not theirs.
   *
   * **You are in your own list.** Excluding yourself seemed tidy and was wrong
   * twice over: in a workspace with one agent it left the list empty, which the
   * editor reads as "mentions are off", so typing @ did nothing at all and
   * looked broken. And naming yourself is genuinely useful — it files the ticket
   * under Mentioning me as a bookmark. Nothing is sent: both the bell and the
   * email skip the person who wrote the comment.
   */
  protected readonly mentionable = computed<MentionCandidate[]>(() => {
    this.lang();
    if (this.mode() === 'private') return [];
    const me = this.session.user()?.id;
    return valueOr(this.agents, []).map((agent) => ({
      id: agent.id,
      name: agent.name || agent.email || '',
      detail:
        agent.id === me
          ? this.transloco.translate('tickets.detail.you')
          : agent.name
            ? (agent.email ?? undefined)
            : undefined,
    }));
  });

  private readonly agents = resource({ loader: () => this.api.agents() });

  /**
   * The roster, for the panels that need to pick somebody. Passed down rather
   * than fetched again in each one: the same list would otherwise be requested
   * three times on one screen.
   */
  protected readonly agentList = computed(() => valueOr(this.agents, []));

  /** Read from the template: an empty menu has to say WHY it is empty. */
  protected readonly canned = resource({ loader: () => this.api.cannedResponses() });

  /**
   * The workspace's snippets, for the ⚡ button.
   *
   * `valueOr` because the composer must not depend on it: a workspace with no
   * snippets, or a failed request, hides the button and leaves everything else
   * working. Loaded with the ticket rather than when the menu opens, so the first
   * click shows a list instead of a spinner.
   */
  protected readonly cannedList = computed(() => valueOr<CannedResponse[]>(this.canned, []));

  /** The editor's own emptiness rule — see the note in `send()`. */
  protected readonly composerEmpty = computed(() => isEmptyHtml(this.body()));

  /**
   * Drops a snippet into the composer — **appended, never replacing**.
   *
   * Two snippets in one reply is a normal thing to want, and an agent who has
   * already typed a sentence should not lose it to a mis-click. The body is
   * stored as plain text, so it is escaped on the way in: a snippet containing
   * "<3" is three characters, not a broken tag.
   */
  protected insertCanned(snippet: CannedResponse): void {
    const addition = `<p>${textToHtml(snippet.body)}</p>`;
    const current = this.body();
    this.body.set(isEmptyHtml(current) ? addition : current + addition);
  }

  /**
   * Toolbar wording for the editor.
   *
   * Passed in rather than resolved inside `@trackly/ui`: a component library
   * that reaches for the app's translation service stops being usable on its
   * own. Rebuilt when the language changes.
   */
  protected readonly editorLabels = computed<Record<string, string>>(() => {
    this.lang();
    const keys = [
      'toolbar', 'bold', 'italic', 'underline', 'strikethrough', 'bulletList',
      'numberedList', 'quote', 'inlineCode', 'codeBlock', 'language', 'link',
      'linkUrl', 'unlink', 'clearFormatting', 'apply', 'cancel',
      'emoji', 'mention', 'noMatches',
      // Nested, so they cannot be built by prefixing `editor.` like the rest.
      'emojiGroups.faces', 'emojiGroups.gestures', 'emojiGroups.work',
    ];
    return Object.fromEntries(
      keys.map((key) => [`editor.${key}`, this.transloco.translate(`editor.${key}`)]),
    );
  });

  /**
   * Pulls the ticket forward after a panel wrote something the header shows.
   *
   * The panels own their own data; this is for the fields that live ON the
   * ticket — the problem association is the one so far.
   */
  /** One flag guarding both buttons — they are next to each other and both write. */
  protected readonly marking = signal(false);

  /**
   * The flag's tooltip carries the reason and who raised it.
   *
   * A flag with no explanation is a red icon somebody has to go and ask about,
   * and the whole point is to save that conversation.
   */
  protected flagTitle(): string {
    const ticket = this.ticket.value();
    if (!ticket?.flaggedAt) return this.transloco.translate('tickets.flag.flag');
    return ticket.flagReason
      ? `${this.transloco.translate('tickets.flag.flagged')}: ${ticket.flagReason}`
      : this.transloco.translate('tickets.flag.unflag');
  }

  protected async togglePin(pinned: boolean): Promise<void> {
    await this.mark(() => this.api.setPinned(this.id(), !pinned));
  }

  /**
   * Raising a flag asks why; clearing one does not.
   *
   * `prompt` rather than a dialog: this is one optional line, and a modal for it
   * would be more machinery than the field is worth. If flags grow options —
   * severity, an assignee — it becomes a dialog then, not before.
   */
  protected async toggleFlag(flagged: boolean): Promise<void> {
    if (flagged) {
      await this.mark(() => this.api.setFlagged(this.id(), false));
      return;
    }
    const reason = window.prompt(this.transloco.translate('tickets.flag.reasonPrompt')) ?? '';
    await this.mark(() => this.api.setFlagged(this.id(), true, reason.trim() || null));
  }

  private async mark(action: () => Promise<unknown>): Promise<void> {
    this.marking.set(true);
    try {
      await action();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      // Reloaded either way: on failure the icon on screen would otherwise show
      // a state the server never took.
      this.reloadTicket();
      this.marking.set(false);
    }
  }

  protected reloadTicket(): void {
    this.ticket.reload();
    this.activityVersion.update((v) => v + 1);
  }

  /** Tabs emit a plain string; narrow it here rather than widening the signal. */
  protected setThreadTab(tab: string): void {
    // The cast is on the ARRAY, not the value: `readonly ThreadTab[].includes`
    // only accepts a ThreadTab, which is the very thing this is checking.
    if ((TAB_IDS as readonly string[]).includes(tab)) this.threadTab.set(tab as ThreadTab);
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
    // Three static strings, never an interpolated class name — `bg-${tone}`
    // emits no CSS at all under Tailwind v4 and fails silently.
    if (comment.visibility === 'private')
      return 'rounded-tr-sm border-dashed border-primary/40 bg-primary/5';
    if (comment.isInternal) return 'rounded-tr-sm border-dashed border-warning/50 bg-warning/10';
    return this.isAgentReply(comment)
      ? 'rounded-tr-sm border-transparent bg-primary'
      : 'rounded-tl-sm border-border bg-card';
  }

  /**
   * The comment is posted first because an attachment has to hang off one. If
   * the upload then fails the comment is already public — so it warns and keeps
   * the comment rather than reporting a failure that would have the agent
   * retype and double-post.
   */
  protected async send(): Promise<void> {
    const body = this.body().trim();
    // isEmptyHtml, not a length check: an emptied contenteditable still holds
    // "<p><br></p>", which is truthy and is not a message.
    if (isEmptyHtml(body) || this.sending()) return;

    this.sending.set(true);
    this.sendError.set(null);
    try {
      const comment = await this.api.addComment(this.id(), {
        body,
        visibility: this.mode(),
        // Still sent, so an API deployed before `visibility` existed still gets
        // the note/reply distinction right.
        isInternal: this.mode() !== 'public',
        bodyFormat: 'html',
      });

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
      this.activityVersion.update((v) => v + 1);
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

  /**
   * The one way status changes, from the select and the Resolve button alike.
   *
   * `statusValue` is mirrored BEFORE the dialog opens, not after. `tk-select`
   * writes its own model on pick, so the only way to push the old value back on
   * a cancel is for the bound expression to actually change — and it only
   * changes if this side moved with the pick first.
   *
   * Resolved and Closed go through the resolve dialog, which collects the reason
   * the API now requires. Open and Pending are a click apart and cost nothing to
   * undo, so they apply straight away — a dialog there would be noise, and a
   * dialog people dismiss without reading is worse than none.
   */
  protected async pickStatus(status: string): Promise<void> {
    const previous = this.statusValue();
    if (status === previous) return;
    this.statusValue.set(status);

    // Whether to ask for a resolution is a CATEGORY question. A workspace's
    // "Shipped" or "Won't fix" sits in resolved or closed just as much as the
    // built-in names do, and the API asks for a note on every one of them —
    // matching on the two literal words would send half of them to a 400.
    const category = this.categoryOf(status);
    if (isTerminalCategory(category)) {
      this.resolveTo.set(status);
      // Narrowed here rather than typing categoryOf: the dialog only has copy
      // for the two terminal ones, and isTerminalCategory has already proved it
      // is one of them.
      this.resolveCategory.set(category === 'closed' ? 'closed' : 'resolved');
      this.resolveError.set(null);
      this.resolveOpen.set(true);
      return;
    }
    await this.write(() => this.api.update(this.id(), { status }));
  }

  /** The dialog's submit. Only closes once the server has taken it. */
  protected async applyResolution(payload: ResolvePayload): Promise<void> {
    this.resolveSaving.set(true);
    this.resolveError.set(null);
    try {
      await this.api.update(this.id(), {
        status: this.resolveTo(),
        resolutionNote: payload.note,
        resolutionLink: payload.link,
        resolutionSummary: payload.summary,
        timeSpentMinutes: payload.minutes,
        // The duplicates the agent ticked, and the fact they saw the warnings.
        // Both come from the dialog rather than being decided here: they are the
        // agent's answers, and this method's job is to carry them, not to guess.
        alsoResolve: payload.alsoResolve.length ? payload.alsoResolve : undefined,
        acknowledgeWarnings: payload.acknowledgeWarnings || undefined,
      });

      // How many other tickets went with it, so the outcome is visible — a
      // cascade that only shows up when somebody opens the other ticket is
      // indistinguishable from one that silently did nothing.
      if (payload.alsoResolve.length) {
        this.toast.success(
          this.transloco.translate('tickets.resolveDialog.duplicates.done', {
            count: payload.alsoResolve.length,
          }),
        );
      }

      this.resolveOpen.set(false);
      this.ticket.reload();
      this.activityVersion.update((v) => v + 1);
      // The resolution is written into the thread as an internal note; the time
      // belongs in the card that lists it, and the link in Related work.
      this.comments.reload();
      this.railVersion.update((n) => n + 1);
    } catch (error) {
      // Stays open with what they typed still in it — retyping a paragraph
      // because a link was malformed is how people stop writing the note at all.
      this.resolveError.set(errorMessage(error));
      // A 409 means the outstanding work changed between the dialog opening and
      // this click — somebody added a task, or a blocker was reopened. Re-read it
      // so the agent is confirming what is true now rather than what was true
      // when they started typing.
      this.preview.reload();
    } finally {
      this.resolveSaving.set(false);
    }
  }

  /** Cancelled or dismissed: put the select back on the server's value. */
  protected onResolveClosed(open: boolean): void {
    if (open) return;
    const status = this.ticket.value()?.status;
    if (status) this.statusValue.set(status);
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
      this.activityVersion.update((v) => v + 1);
    } catch (error) {
      this.toast.error(errorMessage(error));
      // Put the controls back to the server's truth — they are bound to the
      // resource, so a failed write must not leave the UI showing the attempt.
      this.ticket.reload();
      this.activityVersion.update((v) => v + 1);
    }
  }
}
