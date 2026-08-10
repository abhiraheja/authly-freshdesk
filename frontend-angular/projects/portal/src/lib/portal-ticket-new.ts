import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  TicketsApi,
  errorMessage,
  valueOr,
} from '@trackly/core';
import {
  Alert,
  Button,
  Card,
  FilePicker,
  Icon,
  InputDirective,
  LabelDirective,
  Select,
  SelectOption,
  Spinner,
  ToastService,
} from '@trackly/ui';

/**
 * What a signed-in customer fills in to raise a ticket.
 *
 * Three fields, and only two of them required. The agent's version of this form
 * has eight, because an agent is triaging on someone's behalf — a customer is
 * describing a problem, and every extra control is one more thing to get wrong
 * before they can ask for help. Priority, department and assignee are the desk's
 * to decide, not theirs to guess.
 */
@Component({
  selector: 'tk-portal-ticket-new',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoPipe,
    Alert,
    Button,
    Card,
    FilePicker,
    Icon,
    InputDirective,
    LabelDirective,
    Select,
    SelectOption,
    Spinner,
  ],
  template: `
    <div class="mx-auto max-w-[620px]">
      <a
        class="mb-4 inline-flex items-center gap-1.5 text-body font-semibold text-muted-foreground hover:text-foreground"
        routerLink="/portal"
      >
        <tk-icon name="arrow-left" [size]="16" />
        {{ 'portal.tickets.title' | transloco }}
      </a>

      <form (ngSubmit)="submit()">
        <tk-card>
          <div class="space-y-5">
            <header class="mb-1">
              <h1 class="font-display text-page font-extrabold">{{ 'portal.new.title' | transloco }}</h1>
              <p class="mt-1 text-body text-muted-foreground">{{ 'portal.new.subtitle' | transloco }}</p>
            </header>

            <div>
              <label tkLabel for="subject">{{ 'portal.new.subject' | transloco }}</label>
              <input
                tkInput
                inset
                id="subject"
                name="subject"
                required
                autofocus
                maxlength="200"
                [placeholder]="'portal.new.subjectPlaceholder' | transloco"
                [(ngModel)]="subject"
              />
            </div>

            <!-- Optional, and only when the workspace has any: a category picker
                 offering nothing but "No category" is a control that can only
                 waste a decision. -->
            @if (categoryList().length) {
              <div>
                <label tkLabel for="category">{{ 'portal.new.category' | transloco }}</label>
                <tk-select inset inputId="category" [(value)]="categoryId">
                  <tk-option value="" [label]="'portal.new.noCategory' | transloco" />
                  @for (category of categoryList(); track category.id) {
                    <tk-option [value]="category.id" [label]="category.name" />
                  }
                </tk-select>
              </div>
            }

            <div>
              <label tkLabel for="message">{{ 'portal.new.message' | transloco }}</label>
              <textarea
                tkInput
                inset
                id="message"
                name="message"
                rows="6"
                required
                [placeholder]="'portal.new.messagePlaceholder' | transloco"
                [(ngModel)]="description"
              ></textarea>
            </div>

            <div>
              <span class="mb-1.5 block text-meta font-semibold">{{ 'portal.new.attachments' | transloco }}</span>
              <tk-file-picker
                multiple
                [(files)]="files"
                [accept]="attachmentAccept"
                [maxBytes]="maxUploadBytes"
                [disabled]="saving()"
                [progress]="uploadProgress()"
              />
              @if (uploadingName(); as name) {
                <p class="mt-1.5 text-meta text-muted-foreground">
                  {{ 'upload.uploadingFile' | transloco: { name: name } }}
                </p>
              }
            </div>

            <!-- Inline, next to the form that failed. A toast here would be gone
                 four seconds after the one thing they need to read appeared. -->
            @if (error(); as message) {
              <tk-alert tone="danger" [heading]="'portal.new.failed' | transloco">{{ message }}</tk-alert>
            }

            <div class="flex items-center gap-2">
              <button tkButton type="submit" [disabled]="!canSubmit()">
                @if (saving()) {
                  <tk-spinner [size]="16" />
                }
                {{ 'portal.new.submit' | transloco }}
              </button>
              <a tkButton variant="ghost" routerLink="/portal">{{ 'common.cancel' | transloco }}</a>
            </div>
          </div>
        </tk-card>
      </form>
    </div>
  `,
})
export class PortalTicketNew {
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly subject = signal('');
  protected readonly categoryId = signal('');
  protected readonly description = signal('');
  protected readonly files = signal<File[]>([]);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly uploadProgress = signal<number | null>(null);
  protected readonly uploadingName = signal<string | null>(null);

  /** Picker rules are constants shared with the API, not screen state. */
  protected readonly maxUploadBytes = MAX_ATTACHMENT_BYTES;
  protected readonly attachmentAccept = ATTACHMENT_ACCEPT;

  private readonly categories = resource({ loader: () => this.api.categories() });

  /** `valueOr` — a failed category list must not take the form down with it. */
  protected readonly categoryList = computed(() => valueOr(this.categories, []));

  protected readonly canSubmit = computed(
    () => !this.saving() && this.subject().trim().length > 0 && this.description().trim().length > 0,
  );

  /**
   * Creates the ticket, then uploads.
   *
   * The ticket exists before the first byte goes up, so a file that fails is a
   * warning on a ticket that was filed rather than a lost request — and each
   * failure is reported on its own, so one bad file among four does not lose the
   * other three.
   */
  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      const ticket = await this.api.create({
        subject: this.subject().trim(),
        description: this.description().trim(),
        categoryId: this.categoryId() || undefined,
      });

      for (const file of this.files()) {
        this.uploadingName.set(file.name);
        try {
          await this.api.uploadAttachment(ticket.id, file, undefined, (progress) =>
            this.uploadProgress.set(progress.percent),
          );
        } catch (uploadError) {
          this.toast.warning(errorMessage(uploadError));
        }
      }
      this.uploadingName.set(null);
      this.uploadProgress.set(null);

      await this.router.navigate(['/portal/tickets', ticket.id]);
    } catch (createError) {
      this.error.set(errorMessage(createError));
    } finally {
      this.saving.set(false);
    }
  }
}
