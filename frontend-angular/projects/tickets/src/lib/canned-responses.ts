import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import { TicketsApi, errorMessage, type CannedResponse } from '@trackly/core';
import {
  Alert,
  Button,
  Card,
  ConfirmService,
  Drawer,
  EmptyState,
  Icon,
  InputDirective,
  LabelDirective,
  PageHeader,
  SkeletonDirective,
  TableDirective,
  ToastService,
} from '@trackly/ui';

/**
 * The workspace's reusable reply snippets.
 *
 * Managed here, used from the ⚡ button in a ticket's composer — the two halves
 * of one feature, and a snippet library nobody can insert from is just a notes
 * page. The list is workspace-wide rather than per-agent on purpose: the point is
 * that everybody answers the same question the same way.
 *
 * The editor is a **drawer**, not a page. Writing a snippet is a job you do while
 * looking at the others — half of what makes a good one is not repeating one that
 * already exists.
 */
@Component({
  selector: 'tk-canned-responses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Button,
    Card,
    Drawer,
    EmptyState,
    Icon,
    InputDirective,
    LabelDirective,
    PageHeader,
    SkeletonDirective,
    TableDirective,
  ],
  template: `
    <tk-page-header [title]="'canned.title' | transloco" [subtitle]="subtitle()">
      <button tkButton page-actions (click)="startCreate()">
        <tk-icon name="plus" [size]="16" />
        {{ 'canned.add' | transloco }}
      </button>
    </tk-page-header>

    @if (responses.value()) {
      <tk-card flush>
        <div class="overflow-x-auto">
          <table tkTable hover class="min-w-[640px]">
            <thead>
              <tr>
                <th scope="col" class="w-[16rem]">{{ 'canned.columns.title' | transloco }}</th>
                <th scope="col">{{ 'canned.columns.body' | transloco }}</th>
                <th scope="col" class="w-[7rem]">
                  <span class="sr-only">{{ 'common.actions' | transloco }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (item of rows(); track item.id) {
                <tr class="cursor-pointer" (click)="startEdit(item)">
                  <td class="font-semibold">{{ item.title }}</td>
                  <!-- One line of it. The snippet is the point, but a six-line
                       body in every row turns the list into a wall nobody scans. -->
                  <td class="max-w-0">
                    <span class="block truncate text-muted-foreground">{{ item.body }}</span>
                  </td>
                  <td>
                    <span class="row-actions flex justify-end gap-1">
                      <button
                        tkButton
                        variant="ghost"
                        size="sm"
                        iconOnly
                        [attr.aria-label]="'canned.editOne' | transloco: { title: item.title }"
                        (click)="$event.stopPropagation(); startEdit(item)"
                      >
                        <tk-icon name="pencil" [size]="16" />
                      </button>
                      <button
                        tkButton
                        variant="ghost"
                        size="sm"
                        iconOnly
                        class="text-danger"
                        [attr.aria-label]="'canned.deleteOne' | transloco: { title: item.title }"
                        (click)="$event.stopPropagation(); remove(item)"
                      >
                        <tk-icon name="trash-2" [size]="16" />
                      </button>
                    </span>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="3" class="p-0">
                    <tk-empty-state
                      icon="zap"
                      [heading]="'canned.empty' | transloco"
                      [description]="'canned.emptyBody' | transloco"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </tk-card>
    } @else if (responses.error()) {
      <tk-alert tone="danger" [heading]="'canned.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="responses.reload()">
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

    <tk-drawer [(open)]="editorOpen" [heading]="editorHeading()">
      <div class="space-y-4">
        <div>
          <label tkLabel for="canned-title">{{ 'canned.form.title' | transloco }}</label>
          <input
            tkInput
            id="canned-title"
            name="canned-title"
            maxlength="120"
            [placeholder]="'canned.form.titlePlaceholder' | transloco"
            [(ngModel)]="draftTitle"
          />
          <p class="mt-1.5 text-meta text-muted-foreground">{{ 'canned.form.titleHint' | transloco }}</p>
        </div>

        <div>
          <label tkLabel for="canned-body">{{ 'canned.form.body' | transloco }}</label>
          <textarea
            tkInput
            id="canned-body"
            name="canned-body"
            rows="10"
            [placeholder]="'canned.form.bodyPlaceholder' | transloco"
            [(ngModel)]="draftBody"
          ></textarea>
        </div>

        @if (saveError(); as message) {
          <tk-alert tone="danger" [heading]="'canned.saveFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>

      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="editorOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="!canSave()" (click)="save()">{{ 'common.save' | transloco }}</button>
      </div>
    </tk-drawer>
  `,
})
export class CannedResponses {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: '' });

  protected readonly skeletonRows = [0, 1, 2, 3];

  protected readonly responses = resource({ loader: () => this.api.cannedResponses() });
  protected readonly rows = computed(() => this.responses.value() ?? []);
  protected readonly loadError = computed(() => errorMessage(this.responses.error()));

  protected readonly editorOpen = signal(false);
  /** Null while creating — the drawer is one form for both jobs. */
  private readonly editing = signal<CannedResponse | null>(null);
  protected readonly draftTitle = signal('');
  protected readonly draftBody = signal('');
  protected readonly saveError = signal<string | null>(null);
  private readonly saving = signal(false);

  protected readonly subtitle = computed(() => {
    this.lang();
    const count = this.rows().length;
    return count
      ? this.transloco.translate(count === 1 ? 'canned.countOne' : 'canned.count', { count })
      : '';
  });

  protected readonly editorHeading = computed(() => {
    this.lang();
    return this.transloco.translate(this.editing() ? 'canned.editHeading' : 'canned.newHeading');
  });

  protected readonly canSave = computed(
    () => !this.saving() && this.draftTitle().trim().length > 0 && this.draftBody().trim().length > 0,
  );

  protected startCreate(): void {
    this.editing.set(null);
    this.draftTitle.set('');
    this.draftBody.set('');
    this.saveError.set(null);
    this.editorOpen.set(true);
  }

  protected startEdit(item: CannedResponse): void {
    this.editing.set(item);
    this.draftTitle.set(item.title);
    this.draftBody.set(item.body);
    this.saveError.set(null);
    this.editorOpen.set(true);
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;

    const body = { title: this.draftTitle().trim(), body: this.draftBody().trim() };
    const existing = this.editing();

    this.saving.set(true);
    this.saveError.set(null);
    try {
      if (existing) await this.api.updateCannedResponse(existing.id, body);
      else await this.api.createCannedResponse(body);

      this.editorOpen.set(false);
      this.responses.reload();
      this.toast.success(this.transloco.translate('canned.saved', { title: body.title }));
    } catch (error) {
      this.saveError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Confirmed, and named. This is a per-row icon in a dense table, so the
   * subject in the message is the only thing that catches the wrong row.
   */
  protected async remove(item: CannedResponse): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('canned.deleteHeading'),
      message: this.transloco.translate('canned.deleteMessage', { title: item.title }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await this.api.deleteCannedResponse(item.id);
      this.responses.reload();
      this.toast.success(this.transloco.translate('canned.deleted', { title: item.title }));
    } catch (error) {
      this.toast.error(errorMessage(error));
    }
  }
}
