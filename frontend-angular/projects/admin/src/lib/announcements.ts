import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import {
    ANNOUNCEMENT_TYPES,
  settled,
  TicketsApi,
  WorkspaceOpsApi,
  errorMessage,
  formatDateTime,
  valueOr,
  type AnnouncementSummary,
  type ProblemSummary,
  type Tone,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmService,
  Drawer,
  EmptyState,
  Icon,
  InputDirective,
  LabelDirective,
  PageHeader,
  Select,
  SelectOption,
  SkeletonDirective,
  TableDirective,
  ToastService,
} from '@trackly/ui';

/** Type → tone. Static map: an interpolated class emits no CSS at all. */
const TYPE_TONE: Record<string, Tone> = {
  unplanned_outage: 'danger',
  planned_outage: 'warning',
  resolved: 'success',
  general: 'neutral',
};

/**
 * Broadcast announcements — one email to every customer with an account.
 *
 * This is the only screen in Trackly that writes to hundreds of inboxes at once,
 * and none of it can be taken back. So the shape of the page is built around the
 * gap between **writing** one and **sending** it: creating leaves it unsent,
 * sending is a separate, confirmed action that names the audience size, and a
 * sent row is read-only from then on.
 *
 * Guests are deliberately not included: Trackly has no verified opt-in for
 * somebody who only ever emailed the desk once.
 */
@Component({
  selector: 'tk-announcements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    Drawer,
    EmptyState,
    Icon,
    InputDirective,
    LabelDirective,
    PageHeader,
    Select,
    SelectOption,
    SkeletonDirective,
    TableDirective,
  ],
  template: `
    <tk-page-header [title]="'announcements.title' | transloco" [subtitle]="'announcements.subtitle' | transloco">
      <button tkButton page-actions (click)="startCreate()">
        <tk-icon name="megaphone" [size]="16" />
        {{ 'announcements.add' | transloco }}
      </button>
    </tk-page-header>

    @if (loadedAnnouncements()) {
      <tk-card flush>
        <div class="overflow-x-auto">
          <table tkTable class="min-w-[820px]">
            <thead>
              <tr>
                <th scope="col">{{ 'announcements.columns.subject' | transloco }}</th>
                <th scope="col" class="w-[11rem]">{{ 'announcements.columns.type' | transloco }}</th>
                <th scope="col" class="w-[13rem]">{{ 'announcements.columns.status' | transloco }}</th>
                <th scope="col" class="w-[11rem] col-right">{{ 'announcements.columns.delivery' | transloco }}</th>
                <th scope="col" class="w-[8rem] col-right">
                  <span class="sr-only">{{ 'common.actions' | transloco }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (item of rows(); track item.id) {
                <tr>
                  <td class="max-w-0">
                    <span class="block truncate font-semibold">{{ item.subject }}</span>
                    <span class="text-meta text-muted-foreground">{{ when(item.createdAt) }}</span>
                  </td>
                  <td>
                    <tk-badge [tone]="typeTone(item)">{{ 'announcements.types.' + item.type | transloco }}</tk-badge>
                  </td>
                  <td>
                    @if (item.sentAt) {
                      <span class="text-body">{{ 'announcements.sentAt' | transloco: { when: when(item.sentAt) } }}</span>
                    } @else if (item.scheduledAt) {
                      <span class="text-body">
                        {{ 'announcements.scheduledFor' | transloco: { when: when(item.scheduledAt) } }}
                      </span>
                    } @else {
                      <tk-badge tone="neutral">{{ 'announcements.draft' | transloco }}</tk-badge>
                    }
                  </td>
                  <td class="col-right">
                    @if (item.sentAt) {
                      <span class="font-mono text-body">{{ item.successCount }}/{{ item.recipientCount }}</span>
                      <!-- Failures get their own line and their own colour. A
                           bounced batch that reads as "sent" is the one outcome
                           an admin must not be able to scroll past. -->
                      @if (item.failureCount) {
                        <span class="block text-meta font-semibold text-danger">
                          {{ 'announcements.failed' | transloco: { count: item.failureCount } }}
                        </span>
                      }
                    } @else {
                      <span class="text-meta text-muted-foreground">—</span>
                    }
                  </td>
                  <td class="col-right">
                    @if (!item.sentAt) {
                      <button tkButton variant="outline" size="sm" [disabled]="busy()" (click)="send(item)">
                        <tk-icon name="send" [size]="14" />
                        {{ 'announcements.send' | transloco }}
                      </button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="p-0">
                    <tk-empty-state
                      icon="megaphone"
                      [heading]="'announcements.empty' | transloco"
                      [description]="'announcements.emptyBody' | transloco"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </tk-card>
    } @else if (announcements.error()) {
      <tk-alert tone="danger" [heading]="'announcements.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="announcements.reload()">
          {{ 'common.retry' | transloco }}
        </button>
      </tk-alert>
    } @else {
      <tk-card flush>
        <div class="space-y-3 p-4">
          @for (row of skeletonRows; track row) {
            <span tkSkeleton class="block h-8 w-full"></span>
          }
        </div>
      </tk-card>
    }

    <tk-drawer [(open)]="createOpen" [heading]="'announcements.newHeading' | transloco">
      <div class="space-y-4">
        <div>
          <label tkLabel for="ann-type">{{ 'announcements.form.type' | transloco }}</label>
          <tk-select inputId="ann-type" [(value)]="draftType">
            @for (type of types; track type) {
              <tk-option [value]="type" [label]="'announcements.types.' + type | transloco" />
            }
          </tk-select>
        </div>

        <div>
          <label tkLabel for="ann-subject">{{ 'announcements.form.subject' | transloco }}</label>
          <input
            tkInput
            id="ann-subject"
            name="ann-subject"
            maxlength="200"
            [placeholder]="'announcements.form.subjectPlaceholder' | transloco"
            [(ngModel)]="draftSubject"
          />
        </div>

        <div>
          <label tkLabel for="ann-body">{{ 'announcements.form.body' | transloco }}</label>
          <textarea
            tkInput
            id="ann-body"
            name="ann-body"
            rows="8"
            [placeholder]="'announcements.form.bodyPlaceholder' | transloco"
            [(ngModel)]="draftBody"
          ></textarea>
        </div>

        <!-- Optional, and only when there are problems to link to. It is how a
             follow-up "we are back" traces to the outage it closes. -->
        @if (problemList().length) {
          <div>
            <label tkLabel for="ann-problem">{{ 'announcements.form.problem' | transloco }}</label>
            <tk-select inputId="ann-problem" [(value)]="draftProblem">
              <tk-option value="" [label]="'announcements.form.noProblem' | transloco" />
              @for (problem of problemList(); track problem.id) {
                <tk-option [value]="problem.id" [label]="problem.title" />
              }
            </tk-select>
          </div>
        }

        <div>
          <label tkLabel for="ann-schedule">{{ 'announcements.form.schedule' | transloco }}</label>
          <input tkInput id="ann-schedule" name="ann-schedule" type="datetime-local" [(ngModel)]="draftSchedule" />
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'announcements.form.scheduleHint' | transloco }}</p>
        </div>

        @if (createError(); as message) {
          <tk-alert tone="danger" [heading]="'announcements.createFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>

      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="createOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="!canCreate()" (click)="create()">{{ 'announcements.save' | transloco }}</button>
      </div>
    </tk-drawer>
  `,
})
export class Announcements {
  private readonly api = inject(WorkspaceOpsApi);
  private readonly tickets = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  protected readonly skeletonRows = [0, 1, 2];
  protected readonly types = ANNOUNCEMENT_TYPES;

  protected readonly announcements = resource({ loader: () => this.api.announcements() });
  private readonly problems = resource({ loader: () => this.tickets.problems() });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedAnnouncements = settled(() => this.announcements);

  protected readonly rows = computed(() => this.loadedAnnouncements() ?? []);
  protected readonly problemList = computed(() => valueOr(this.problems, [] as ProblemSummary[]));
  protected readonly loadError = computed(() => errorMessage(this.announcements.error()));

  protected readonly busy = signal(false);
  protected readonly createOpen = signal(false);
  protected readonly draftType = signal<string>('unplanned_outage');
  protected readonly draftSubject = signal('');
  protected readonly draftBody = signal('');
  protected readonly draftProblem = signal('');
  protected readonly draftSchedule = signal('');
  protected readonly createError = signal<string | null>(null);

  protected readonly canCreate = computed(
    () => !this.busy() && this.draftSubject().trim().length > 0 && this.draftBody().trim().length > 0,
  );

  protected typeTone(item: AnnouncementSummary): Tone {
    return TYPE_TONE[item.type] ?? 'neutral';
  }

  protected when(iso: string): string {
    return formatDateTime(iso);
  }

  protected startCreate(): void {
    this.draftType.set('unplanned_outage');
    this.draftSubject.set('');
    this.draftBody.set('');
    this.draftProblem.set('');
    this.draftSchedule.set('');
    this.createError.set(null);
    this.createOpen.set(true);
  }

  /**
   * Creates it **unsent**, always.
   *
   * Even with a schedule filled in, nothing leaves until the worker's time comes
   * or somebody presses Send. Writing and sending are one keystroke apart on
   * most tools and that is exactly the keystroke worth separating here.
   */
  protected async create(): Promise<void> {
    if (!this.canCreate()) return;

    this.busy.set(true);
    this.createError.set(null);
    try {
      await this.api.createAnnouncement({
        type: this.draftType(),
        subject: this.draftSubject().trim(),
        body: this.draftBody().trim(),
        problemId: this.draftProblem() || undefined,
        // `datetime-local` gives local wall time with no zone; the Date makes it
        // an instant in the admin's own zone, which is the one they typed in.
        scheduledAt: this.draftSchedule() ? new Date(this.draftSchedule()).toISOString() : undefined,
      });
      this.createOpen.set(false);
      this.announcements.reload();
      this.toast.success(this.transloco.translate('announcements.created'));
    } catch (error) {
      this.createError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Sends now. Confirmed, and the message says how many people it reaches —
   * there is no unsend, and "are you sure?" without a number is a question
   * nobody can actually answer.
   */
  protected async send(item: AnnouncementSummary): Promise<void> {
    this.lang();
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('announcements.sendHeading'),
      message: this.transloco.translate('announcements.sendMessage', { subject: item.subject }),
      confirmLabel: this.transloco.translate('announcements.sendConfirm'),
      tone: 'primary',
    });
    if (!ok) return;

    this.busy.set(true);
    try {
      const sent = await this.api.sendAnnouncement(item.id);
      this.announcements.reload();
      this.toast.success(
        this.transloco.translate('announcements.sent', { count: sent.successCount }),
      );
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
