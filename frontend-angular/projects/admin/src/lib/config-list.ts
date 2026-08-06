import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { Badge, Button, Card, Icon, InputDirective, Spinner } from '@trackly/ui';

/**
 * One row of a configurable list, flattened from whatever entity it came from.
 *
 * `canDeactivate` and `canDelete` are computed by the page, not inferred here —
 * the rules differ per list (a built-in priority can't be deleted, a department
 * can) and a shared component guessing them would be wrong half the time.
 */
export interface ConfigRow {
  readonly id: string;
  readonly label: string;
  /** Secondary text: member count, the stored value, "built-in". */
  readonly meta?: string;
  readonly color?: string | null;
  readonly isActive?: boolean;
  readonly canRename: boolean;
  readonly canDeactivate: boolean;
  readonly canDelete: boolean;
}

/**
 * The presentational half of the configuration page: a titled card holding an
 * editable list plus an "add" row.
 *
 * Four lists (departments, categories, priorities, channels) sit on four
 * different endpoints with four different rules, but they are the same *screen*
 * four times. This owns the screen; the page owns the rules and does every
 * write, which is why nothing here calls an API.
 *
 * Inline rename rather than a modal: renaming is the most common edit on these
 * lists by a wide margin, and a dialog per rename turns a two-minute tidy-up
 * into twenty clicks.
 */
@Component({
  selector: 'tk-config-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslocoPipe, Badge, Button, Card, Icon, InputDirective, Spinner],
  template: `
    <tk-card [heading]="heading()" [subheading]="description()" flush>
      <!-- Four states, and the order matters: a list that FAILED must never fall
           through to the empty state, which would claim there is nothing there
           when the truth is that nobody managed to look. -->
      @if (loading()) {
        <div class="flex items-center gap-2 p-5 text-body text-muted-foreground">
          <tk-spinner [size]="16" />
          {{ 'common.loading' | transloco }}
        </div>
      } @else if (error()) {
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-4 text-body">
          <tk-icon name="alert-circle" [size]="16" class="shrink-0 text-danger" />
          <span class="text-danger">{{ error() }}</span>
          <button type="button" class="font-semibold underline" (click)="retry.emit()">
            {{ 'common.retry' | transloco }}
          </button>
        </div>
      } @else {
        <ul class="divide-y divide-border">
          @for (row of rows(); track row.id) {
            <li class="flex items-center gap-3 px-5 py-3">
              @if (editingId() === row.id) {
                <input
                  tkInput
                  inputSize="sm"
                  class="flex-1"
                  [attr.aria-label]="'admin.config.renameLabel' | transloco"
                  [(ngModel)]="draft"
                  (keydown.enter)="commitRename(row)"
                  (keydown.escape)="cancelRename()"
                />
                <button tkButton size="sm" (click)="commitRename(row)">{{ 'common.save' | transloco }}</button>
                <button tkButton size="sm" variant="ghost" (click)="cancelRename()">
                  {{ 'common.cancel' | transloco }}
                </button>
              } @else {
                @if (row.color) {
                  <span class="size-2.5 shrink-0 rounded-full" [style.background]="row.color"></span>
                }
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-body font-semibold" [class.text-muted-foreground]="row.isActive === false">
                    {{ row.label }}
                  </span>
                  @if (row.meta) {
                    <span class="block truncate text-meta text-muted-foreground">{{ row.meta }}</span>
                  }
                </span>

                @if (row.isActive === false) {
                  <tk-badge tone="neutral">{{ 'admin.config.inactive' | transloco }}</tk-badge>
                }

                <span class="flex shrink-0 items-center gap-0.5">
                  @if (row.canRename) {
                    <button
                      type="button"
                      class="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-primary"
                      [attr.aria-label]="('admin.config.rename' | transloco) + ' ' + row.label"
                      (click)="startRename(row)"
                    >
                      <tk-icon name="pencil" [size]="16" />
                    </button>
                  }
                  @if (row.canDeactivate) {
                    <button
                      type="button"
                      class="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-primary"
                      [attr.aria-label]="
                        ((row.isActive === false ? 'admin.config.activate' : 'admin.config.deactivate') | transloco) +
                        ' ' + row.label
                      "
                      (click)="setActive.emit({ row, isActive: row.isActive === false })"
                    >
                      <tk-icon [name]="row.isActive === false ? 'check-circle' : 'circle'" [size]="16" />
                    </button>
                  }
                  @if (row.canDelete) {
                    <button
                      type="button"
                      class="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-danger"
                      [attr.aria-label]="('admin.config.delete' | transloco) + ' ' + row.label"
                      (click)="remove.emit(row)"
                    >
                      <tk-icon name="trash-2" [size]="16" />
                    </button>
                  }
                </span>
              }
            </li>
          } @empty {
            <li class="px-5 py-6 text-center text-body text-muted-foreground">
              {{ 'admin.config.empty' | transloco }}
            </li>
          }
        </ul>
      }

      <div card-footer class="card-footer flex items-center gap-2">
        <input
          tkInput
          inputSize="sm"
          inset
          class="flex-1"
          [placeholder]="addPlaceholder()"
          [attr.aria-label]="addPlaceholder()"
          [(ngModel)]="newLabel"
          (keydown.enter)="commitAdd()"
        />
        <button tkButton size="sm" [disabled]="!newLabel().trim() || busy()" (click)="commitAdd()">
          <tk-icon name="plus" [size]="14" />
          {{ 'admin.config.add' | transloco }}
        </button>
      </div>
    </tk-card>
  `,
})
export class ConfigList {
  readonly heading = input('');
  readonly description = input('');
  readonly addPlaceholder = input('');
  readonly rows = input<readonly ConfigRow[]>([]);
  readonly loading = input(false);
  readonly busy = input(false);
  /** Message from the list's own fetch. Null when it loaded. */
  readonly error = input<string | null>(null);

  readonly retry = output<void>();
  readonly add = output<string>();
  readonly rename = output<{ row: ConfigRow; label: string }>();
  readonly setActive = output<{ row: ConfigRow; isActive: boolean }>();
  readonly remove = output<ConfigRow>();

  protected readonly newLabel = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal('');

  protected startRename(row: ConfigRow): void {
    this.editingId.set(row.id);
    this.draft.set(row.label);
  }

  protected cancelRename(): void {
    this.editingId.set(null);
    this.draft.set('');
  }

  protected commitRename(row: ConfigRow): void {
    const label = this.draft().trim();
    // An unchanged name is a no-op, not a request — firing one would show a
    // "saved" toast for a save that never happened.
    if (label && label !== row.label) this.rename.emit({ row, label });
    this.cancelRename();
  }

  protected commitAdd(): void {
    const label = this.newLabel().trim();
    if (!label) return;
    this.add.emit(label);
    this.newLabel.set('');
  }
}
