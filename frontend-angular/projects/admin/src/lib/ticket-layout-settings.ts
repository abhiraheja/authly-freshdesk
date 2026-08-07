import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TicketsApi, errorMessage, valueOr, type TicketOption } from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  Icon,
  InputDirective,
  SkeletonDirective,
  Spinner,
  ToastService,
} from '@trackly/ui';

/**
 * Admin → Ticket layout: which cards the ticket view's side panel draws, and in
 * what order.
 *
 * Stored in the same `ticket_options` table as priorities and channels —
 * `sortOrder` is the position, `isActive` is whether it is drawn. The keys
 * belong to Trackly because the rail switches on them to pick a renderer, which
 * is why nothing here adds or deletes a row: an invented key would be a line on
 * this screen that draws nothing at all.
 *
 * **Hiding a card changes what is rendered and nothing else.** Every field
 * behind one is nullable, so a workspace that switches SLA off does not lose an
 * SLA — it stops looking at it, and switching it back on brings the whole card
 * back exactly as it was. That is the sentence the hint under the list says,
 * because it is the question every admin asks before touching this.
 *
 * Up/down rather than drag-and-drop: ten rows is a list, not a canvas, and two
 * buttons work with a keyboard, on a phone, and with a screen reader without any
 * of the machinery a drag surface needs to do the same.
 */
@Component({
  selector: 'tk-admin-ticket-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    Icon,
    InputDirective,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <div class="mx-auto max-w-[720px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.layout.title' | transloco }}</h1>
      <p class="mb-6 mt-1 text-body text-muted-foreground">{{ 'admin.layout.subtitle' | transloco }}</p>

      <!-- Value first, skeleton last: every write reloads, and swapping the list
           for a skeleton each time would make reordering flicker once per click. -->
      @if (panels.value()) {
        <tk-card flush>
          <ul class="divide-y divide-border">
            @for (panel of list(); track panel.id; let index = $index, last = $last) {
              <li class="flex items-center gap-3 px-5 py-3" [class.opacity-60]="!panel.isActive">
                <div class="flex shrink-0 flex-col">
                  <button
                    type="button"
                    class="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                    [disabled]="index === 0 || busy()"
                    [attr.aria-label]="'admin.layout.moveUp' | transloco"
                    (click)="move(index, -1)"
                  >
                    <tk-icon name="chevron-down" [size]="14" class="rotate-180" />
                  </button>
                  <button
                    type="button"
                    class="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                    [disabled]="last || busy()"
                    [attr.aria-label]="'admin.layout.moveDown' | transloco"
                    (click)="move(index, 1)"
                  >
                    <tk-icon name="chevron-down" [size]="14" />
                  </button>
                </div>

                @if (renaming() === panel.id) {
                  <input
                    tkInput
                    inset
                    inputSize="sm"
                    class="min-w-0 flex-1"
                    [attr.aria-label]="'admin.layout.renameLabel' | transloco"
                    [(ngModel)]="draftLabel"
                    (keydown.enter)="commitRename(panel)"
                    (keydown.escape)="renaming.set(null)"
                  />
                  <button tkButton size="sm" [disabled]="busy()" (click)="commitRename(panel)">
                    {{ 'common.save' | transloco }}
                  </button>
                  <button tkButton variant="ghost" size="sm" (click)="renaming.set(null)">
                    {{ 'common.cancel' | transloco }}
                  </button>
                } @else {
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-body font-semibold">{{ panel.label }}</p>
                    <p class="truncate font-mono text-meta text-muted-foreground">{{ panel.value }}</p>
                  </div>

                  <tk-badge [tone]="panel.isActive ? 'success' : 'neutral'">
                    {{ (panel.isActive ? 'admin.layout.shown' : 'admin.layout.hidden') | transloco }}
                  </tk-badge>

                  <button tkButton variant="ghost" size="sm" [disabled]="busy()" (click)="startRename(panel)">
                    {{ 'admin.layout.rename' | transloco }}
                  </button>
                  <button
                    tkButton
                    variant="outline"
                    size="sm"
                    [disabled]="busy()"
                    (click)="setActive(panel, !panel.isActive)"
                  >
                    {{ (panel.isActive ? 'admin.layout.hide' : 'admin.layout.show') | transloco }}
                  </button>
                }
              </li>
            }
          </ul>

          <div card-footer class="card-footer">
            <p class="flex items-start gap-2 text-meta text-muted-foreground">
              <tk-icon name="info" [size]="14" class="mt-0.5 shrink-0" />
              <span>{{ 'admin.layout.hint' | transloco }}</span>
              @if (busy()) {
                <tk-spinner [size]="14" class="ml-auto shrink-0" />
              }
            </p>
          </div>
        </tk-card>
      } @else if (panels.error()) {
        <tk-alert tone="danger" [heading]="'admin.layout.loadFailed' | transloco">
          {{ loadError() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="panels.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <span tkSkeleton class="h-96 w-full"></span>
      }
    </div>
  `,
})
export class TicketLayoutSettings {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** `includeInactive`, or a hidden card could never be brought back. */
  protected readonly panels = resource({
    loader: () => this.api.ticketOptions('ticket_panel', true),
  });

  protected readonly busy = signal(false);
  protected readonly renaming = signal<string | null>(null);
  protected readonly draftLabel = signal('');

  protected readonly list = computed(() => valueOr(this.panels, []));
  protected readonly loadError = computed(() => errorMessage(this.panels.error()));

  /**
   * Swaps a row with its neighbour by exchanging the two `sortOrder` values.
   *
   * Two writes rather than renumbering the whole list: only two rows actually
   * changed position, and rewriting all ten would turn one misclick into ten
   * rows to put back.
   */
  protected async move(index: number, direction: -1 | 1): Promise<void> {
    const rows = this.list();
    const a = rows[index];
    const b = rows[index + direction];
    if (!a || !b || this.busy()) return;

    this.busy.set(true);
    try {
      await this.api.updateTicketOption(a.id, { sortOrder: b.sortOrder });
      await this.api.updateTicketOption(b.id, { sortOrder: a.sortOrder });
      this.panels.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
      // Reload on failure too: one of the two writes may have landed, and the
      // list on screen would otherwise show an order the server never took.
      this.panels.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async setActive(panel: TicketOption, isActive: boolean): Promise<void> {
    await this.write(() => this.api.updateTicketOption(panel.id, { isActive }));
  }

  protected startRename(panel: TicketOption): void {
    this.draftLabel.set(panel.label);
    this.renaming.set(panel.id);
  }

  protected async commitRename(panel: TicketOption): Promise<void> {
    const label = this.draftLabel().trim();
    // An empty label would leave a card with no heading and therefore nothing to
    // click to collapse it. Treated as a cancel rather than an error.
    if (!label || label === panel.label) {
      this.renaming.set(null);
      return;
    }
    this.renaming.set(null);
    await this.write(() => this.api.updateTicketOption(panel.id, { label }));
  }

  private async write(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.panels.reload();
      this.toast.success(this.transloco.translate('admin.layout.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
      this.panels.reload();
    } finally {
      this.busy.set(false);
    }
  }
}
