import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { TicketsApi, errorMessage, formatBytes } from '@trackly/core';
import {
  Alert,
  Button,
  Card,
  Combobox,
  Icon,
  InputDirective,
  LabelDirective,
  Spinner,
  TagInput,
  ToastService,
} from '@trackly/ui';

/**
 * New ticket — the "Form" page shape: one column, capped width, a single card,
 * actions pinned at its foot.
 *
 * **Where each field's choices come from.** Department, priority, category and
 * channel are all admin-configured lists, fetched as four independent resources
 * so one failing leaves the others usable. Only tags are free text — a new one
 * is created when the ticket saves.
 *
 * **Two fields are the caller's to leave alone.** Subject and description are
 * the only required ones; everything else, requester included, can be set later
 * from the ticket. There is still no assignee field, because the server picks
 * that itself (round-robin within the chosen department) — a control for it
 * would be one that silently does nothing.
 */
@Component({
  selector: 'tk-ticket-new',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    RouterLink,
    Alert,
    Button,
    Card,
    Combobox,
    Icon,
    InputDirective,
    LabelDirective,
    Spinner,
    TagInput,
  ],
  template: `
    <div class="mx-auto max-w-[680px]">
      <a
        class="mb-4 inline-flex items-center gap-1.5 text-body font-semibold text-muted-foreground hover:text-foreground"
        routerLink="/dashboard/tickets"
      >
        <tk-icon name="arrow-left" [size]="16" />
        {{ 'tickets.title' | transloco }}
      </a>

      <form (ngSubmit)="submit()">
        <tk-card>
          <div class="space-y-5">
            <header class="mb-1">
              <h1 class="font-display text-page font-extrabold">{{ 'tickets.new.title' | transloco }}</h1>
              <p class="mt-1 text-body text-muted-foreground">{{ 'tickets.new.subtitle' | transloco }}</p>
            </header>

            <!-- Requester. Free text over the workspace's people so an agent can
                 log a call without leaving the form, but the VALUE is an id: a
                 name that matches nobody files under the agent, which the hint
                 below says out loud rather than letting it surprise them. -->
            <div>
              <label tkLabel for="requester">{{ 'tickets.new.requester' | transloco }}</label>
              <tk-combobox
                inset
                inputId="requester"
                [(value)]="requesterLabel"
                [suggestions]="customerNames()"
                [placeholder]="'tickets.new.requesterPlaceholder' | transloco"
                [toggleLabel]="'tickets.new.showSuggestions' | transloco"
              />
              <p class="mt-1.5 text-meta text-muted-foreground">
                {{ (requesterId() ? 'tickets.new.requesterMatched' : 'tickets.new.requesterSelf') | transloco }}
              </p>
            </div>

            <div>
              <label tkLabel for="subject">{{ 'tickets.new.subject' | transloco }}</label>
              <input
                tkInput
                inset
                #subjectField
                id="subject"
                name="subject"
                required
                maxlength="200"
                [placeholder]="'tickets.new.subjectPlaceholder' | transloco"
                [(ngModel)]="subject"
              />
            </div>

            <!-- 2×2. Department and Category are different axes: the department
                 is WHO handles it (and actually routes the assignment), the
                 category is WHAT it is about. -->
            <div class="grid gap-5 sm:grid-cols-2">
              <div>
                <label tkLabel for="team">{{ 'tickets.new.department' | transloco }}</label>
                <select tkInput inset id="team" name="team" [(ngModel)]="teamId">
                  <option value="">{{ 'tickets.new.noDepartment' | transloco }}</option>
                  @for (team of teamList(); track team.id) {
                    <option [value]="team.id">{{ team.name }}</option>
                  }
                </select>
              </div>

              <!-- Priority and channel come from the workspace's configured
                   lists, so the label is whatever the admin called it. Bind the
                   value, render the label: renaming an option must not rewrite
                   the tickets already carrying it. -->
              <div>
                <label tkLabel for="priority">{{ 'tickets.columns.priority' | transloco }}</label>
                <select tkInput inset id="priority" name="priority" [(ngModel)]="priority">
                  @for (option of priorityOptions(); track option.id) {
                    <option [value]="option.value">{{ option.label }}</option>
                  }
                </select>
              </div>

              <div>
                <label tkLabel for="category">{{ 'tickets.new.category' | transloco }}</label>
                <select tkInput inset id="category" name="category" [(ngModel)]="categoryId">
                  <option value="">{{ 'tickets.new.noCategory' | transloco }}</option>
                  @for (category of categoryList(); track category.id) {
                    <option [value]="category.id">{{ category.name }}</option>
                  }
                </select>
              </div>

              <div>
                <label tkLabel for="channel">{{ 'tickets.new.channel' | transloco }}</label>
                <select tkInput inset id="channel" name="channel" [(ngModel)]="channel">
                  @for (option of channelOptions(); track option.id) {
                    <option [value]="option.value">{{ option.label }}</option>
                  }
                </select>
              </div>
            </div>

            <div>
              <label tkLabel for="tags">{{ 'tickets.new.tags' | transloco }}</label>
              <tk-tag-input
                inset
                inputId="tags"
                [(value)]="tags"
                [suggestions]="tagNames()"
                [placeholder]="'tickets.new.tagsPlaceholder' | transloco"
                [removeLabel]="'tickets.new.removeTag' | transloco"
                [createLabel]="'tickets.new.createTag' | transloco"
              />
              <p class="mt-1.5 text-meta text-muted-foreground">{{ 'tickets.new.tagsHint' | transloco }}</p>
            </div>

            <div>
              <label tkLabel for="description">{{ 'tickets.new.description' | transloco }}</label>
              <textarea
                tkInput
                inset
                id="description"
                name="description"
                rows="7"
                required
                [placeholder]="'tickets.new.descriptionPlaceholder' | transloco"
                [(ngModel)]="description"
              ></textarea>
            </div>

            <div>
              <span class="mb-1.5 block text-meta font-semibold">{{ 'tickets.new.attachment' | transloco }}</span>
              @if (file(); as chosen) {
                <div class="flex items-center gap-3 rounded-xl border border-border bg-muted px-3 py-2.5">
                  <tk-icon name="paperclip" [size]="16" class="shrink-0 text-muted-foreground" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-body font-semibold">{{ chosen.name }}</span>
                    <span class="block text-meta text-muted-foreground">{{ size() }}</span>
                  </span>
                  <button
                    type="button"
                    class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-danger"
                    [attr.aria-label]="'tickets.new.removeFile' | transloco"
                    (click)="clearFile()"
                  >
                    <tk-icon name="x" [size]="16" />
                  </button>
                </div>
              } @else {
                <!-- The input lives INSIDE the label, so the dropzone is reachable
                     by keyboard and by click without any JS. -->
                <label class="dropzone" [class.is-dragging]="dragging()"
                       (dragover)="onDragOver($event)" (dragleave)="dragging.set(false)" (drop)="onDrop($event)">
                  <tk-icon name="upload-cloud" [size]="24" />
                  <span class="text-body font-semibold">{{ 'tickets.new.dropHint' | transloco }}</span>
                  <span class="text-meta">{{ 'tickets.new.dropLimit' | transloco }}</span>
                  <input type="file" class="sr-only" (change)="pick($event)" />
                </label>
              }
              @if (fileError()) {
                <p class="mt-1.5 text-meta text-danger">{{ fileError() }}</p>
              }
            </div>

            @if (error(); as message) {
              <tk-alert tone="danger" [heading]="'tickets.new.failed' | transloco">{{ message }}</tk-alert>
            }
          </div>

          <!-- card-footer twice on purpose: the bare attribute is the
               projection slot, the class is the padding + top rule. -->
          <div card-footer class="card-footer flex items-center justify-end gap-2">
            <a tkButton variant="ghost" routerLink="/dashboard/tickets">{{ 'common.cancel' | transloco }}</a>
            <button tkButton type="submit" [disabled]="!canSubmit()">
              @if (saving()) {
                <tk-spinner [size]="16" />
              } @else {
                <tk-icon name="send" [size]="16" />
              }
              {{ 'tickets.new.submit' | transloco }}
            </button>
          </div>
        </tk-card>
      </form>
    </div>
  `,
})
export class TicketNew {
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /**
   * The plain `autofocus` attribute is useless here: the browser honours it once,
   * while parsing the document. Arriving on this route is a client-side
   * navigation, so the attribute would never fire and the caret would sit
   * nowhere. Focus has to be moved in code, after the field exists.
   */
  private readonly subjectField = viewChild.required<ElementRef<HTMLInputElement>>('subjectField');

  constructor() {
    afterNextRender(() => this.subjectField().nativeElement.focus());
  }

  protected readonly subject = signal('');
  protected readonly description = signal('');
  protected readonly priority = signal<string>('medium');
  protected readonly categoryId = signal('');
  protected readonly channel = signal('');
  protected readonly teamId = signal('');
  protected readonly tags = signal<string[]>([]);
  /** What the agent typed into the requester box — a display name, not an id. */
  protected readonly requesterLabel = signal('');
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly dragging = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * Three independent suggestion sources. Each is its own resource so one
   * failing (tags are agent-only, for instance) leaves the other two working —
   * a single combined fetch would take all three down together.
   */
  private readonly categories = resource({ loader: () => this.api.categories() });
  private readonly priorities = resource({ loader: () => this.api.ticketOptions('priority') });
  private readonly channels = resource({ loader: () => this.api.ticketOptions('channel') });
  private readonly tagCatalogue = resource({ loader: () => this.api.tags() });
  private readonly teams = resource({ loader: () => this.api.teams() });
  private readonly customers = resource({ loader: () => this.api.users('customer') });

  protected readonly teamList = computed(() => this.teams.value() ?? []);
  protected readonly categoryList = computed(() => this.categories.value() ?? []);
  protected readonly priorityOptions = computed(() => this.priorities.value() ?? []);
  protected readonly channelOptions = computed(() => this.channels.value() ?? []);

  /**
   * "Name (email)" reads as one searchable string, and the email is what makes
   * two people called Priya distinguishable.
   */
  private readonly customerOptions = computed(() =>
    (this.customers.value() ?? []).map((user) => ({
      id: user.id,
      label: user.name ? `${user.name} (${user.email ?? ''})`.replace(' ()', '') : (user.email ?? user.id),
    })),
  );
  protected readonly customerNames = computed(() => this.customerOptions().map((option) => option.label));

  /** Null until the typed text is exactly one of the offered people. */
  protected readonly requesterId = computed(() => {
    const typed = this.requesterLabel().trim().toLowerCase();
    if (!typed) return null;
    return this.customerOptions().find((option) => option.label.toLowerCase() === typed)?.id ?? null;
  });

  /** Most-used first: the tag someone wants is far likelier to be a common one. */
  protected readonly tagNames = computed(() =>
    [...(this.tagCatalogue.value() ?? [])]
      .sort((a, b) => b.ticketCount - a.ticketCount || a.name.localeCompare(b.name))
      .map((tag) => tag.name),
  );

  protected readonly size = computed(() => {
    const chosen = this.file();
    return chosen ? formatBytes(chosen.size) : '';
  });

  protected readonly canSubmit = computed(
    () => !this.saving() && this.subject().trim().length > 0 && this.description().trim().length > 0,
  );

  protected pick(event: Event): void {
    this.take((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.take(event.dataTransfer?.files?.[0] ?? null);
  }

  private take(chosen: File | null): void {
    if (chosen && chosen.size > MAX_UPLOAD_BYTES) {
      this.fileError.set(`Attachment is larger than ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    this.fileError.set(null);
    this.file.set(chosen);
  }

  protected clearFile(): void {
    this.file.set(null);
    this.fileError.set(null);
  }

  /**
   * Two calls, because attachments hang off a ticket that already exists.
   *
   * That ordering matters for failure: once `create` resolves the ticket is
   * real, so a failed upload can never be reported as a failed submission —
   * it warns and still navigates. Telling the agent "couldn't create ticket"
   * there would send them off to file a duplicate.
   */
  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.error.set(null);

    try {
      // One request. The department, the channel and any brand-new tags are
      // created server-side as part of writing the ticket — so abandoning this
      // form leaves nothing behind, and a rejected ticket doesn't leave an
      // orphan department that was minted a moment earlier.
      const ticket = await this.api.create({
        subject: this.subject().trim(),
        description: this.description().trim(),
        priority: this.priority(),
        categoryId: this.categoryId() || undefined,
        channel: this.channel().trim() || undefined,
        tags: this.tags().length ? this.tags() : undefined,
        teamId: this.teamId() || undefined,
        requesterId: this.requesterId() ?? undefined,
      });

      const chosen = this.file();
      if (chosen) {
        try {
          await this.api.uploadAttachment(ticket.id, chosen);
        } catch (uploadError) {
          this.toast.warning(errorMessage(uploadError));
        }
      }

      this.toast.success(ticket.subject);
      // The detail screen is still on ComingSoon; once it lands, send them to
      // `['/dashboard/tickets', ticket.id]` instead.
      await this.router.navigate(['/dashboard/tickets']);
    } catch (createError) {
      this.error.set(errorMessage(createError));
    } finally {
      this.saving.set(false);
    }
  }
}

/** Matches the server's upload cap — see `AttachmentService`. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
