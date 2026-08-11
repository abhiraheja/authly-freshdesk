import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  settled,
    STATUS_CATEGORIES,
  STATUS_TONE,
  TicketsApi,
  errorMessage,
  toneFor,
  valueOr,
  type StatusCategory,
  type TicketStatus,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmService,
  Icon,
  InputDirective,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  Tabs,
  ToastService,
  type TabItem,
} from '@trackly/ui';
import { StatusWorkflow } from './status-workflow';

/**
 * Admin → Statuses & workflow.
 *
 * **The five categories are Trackly's; the statuses under them are yours.** A
 * workspace that wants Todo → Estimated → In review → Done writes exactly that,
 * and each one is filed under a category so the rest of Trackly still knows what
 * it means. Every rule in the product — SLA clocks, the open/resolved counts on
 * the dashboard, whether a resolution note is demanded, whether the CSAT survey
 * goes out — reads the CATEGORY. Nothing anywhere reads the name.
 *
 * That is why each section carries a sentence about what its category does. An
 * admin filing "Waiting on customer" has to be able to see, before they file it,
 * that Pending is the one that stops the SLA clock.
 *
 * **Retire rather than delete.** Deleting is offered only for a status nothing
 * is using, because a ticket holding a value with no status behind it renders as
 * a raw slug — the database looks corrupt when the truth is just that someone
 * tidied up. The API enforces this; the button is hidden to save the round trip.
 *
 * Workflow lives on the second tab and is destroyed when you leave it, so it
 * always reloads against the statuses as they are now.
 */
@Component({
  selector: 'tk-admin-ticket-statuses',
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
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
    Tabs,
    StatusWorkflow,
  ],
  template: `
    <div class="mx-auto max-w-[860px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.statuses.title' | transloco }}</h1>
      <p class="mb-5 mt-1 text-body text-muted-foreground">{{ 'admin.statuses.subtitle' | transloco }}</p>

      <tk-tabs class="mb-5" [tabs]="tabs()" [(active)]="tab" panelId="statuses-panel" />

      <div id="statuses-panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
        @switch (tab()) {
          @case ('workflow') {
            @if (loadedStatuses()) {
              <tk-admin-status-workflow [statuses]="active()" />
            } @else {
              <span tkSkeleton class="h-80 w-full"></span>
            }
          }

          @default {
            <!-- Value first, skeleton last: every write reloads, and swapping in
                 a skeleton each time would make the list jump on every click. -->
            @if (loadedStatuses()) {
              <p class="mb-4 flex items-start gap-2 text-meta text-muted-foreground">
                <tk-icon name="info" [size]="14" class="mt-0.5 shrink-0" />
                <span>{{ 'admin.statuses.categoryHint' | transloco }}</span>
              </p>

              @for (group of groups(); track group.category) {
                <section class="mb-6">
                  <!-- The category header sits outside the card on purpose: it
                       describes what Trackly does with everything in the card,
                       which is a different claim from any one row in it. -->
                  <div class="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <tk-badge [tone]="tone(group.category).tone">
                      {{ tone(group.category).labelKey | transloco }}
                    </tk-badge>
                    <p class="min-w-0 flex-1 text-meta text-muted-foreground">{{ behaviour(group.category) }}</p>
                  </div>

                  <tk-card flush>
                  <ul class="divide-y divide-border">
                    @for (status of group.statuses; track status.id; let index = $index, last = $last) {
                      <li class="flex flex-wrap items-center gap-3 px-5 py-3" [class.opacity-60]="!status.isActive">
                        <div class="flex shrink-0 flex-col">
                          <button
                            type="button"
                            class="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                            [disabled]="index === 0 || busy()"
                            [attr.aria-label]="'admin.statuses.moveUp' | transloco"
                            (click)="move(group.statuses, index, -1)"
                          >
                            <tk-icon name="chevron-down" [size]="14" class="rotate-180" />
                          </button>
                          <button
                            type="button"
                            class="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                            [disabled]="last || busy()"
                            [attr.aria-label]="'admin.statuses.moveDown' | transloco"
                            (click)="move(group.statuses, index, 1)"
                          >
                            <tk-icon name="chevron-down" [size]="14" />
                          </button>
                        </div>

                        @if (editing() === status.id) {
                          <div class="flex min-w-0 flex-1 basis-full flex-col gap-2 sm:basis-auto sm:flex-row sm:items-center">
                            <input
                              tkInput
                              inset
                              inputSize="sm"
                              class="min-w-0 flex-1"
                              [attr.aria-label]="'admin.statuses.nameLabel' | transloco"
                              [(ngModel)]="draftName"
                              (keydown.enter)="commit(status)"
                              (keydown.escape)="editing.set(null)"
                            />
                            <tk-select
                              inset
                              size="sm"
                              [ariaLabel]="'admin.statuses.categoryLabel' | transloco"
                              [(value)]="draftCategory"
                            >
                              @for (category of categories; track category) {
                                <tk-option [value]="category" [label]="categoryName(category)" />
                              }
                            </tk-select>
                          </div>

                          <button tkButton size="sm" [disabled]="busy()" (click)="commit(status)">
                            {{ 'common.save' | transloco }}
                          </button>
                          <button tkButton variant="ghost" size="sm" (click)="editing.set(null)">
                            {{ 'common.cancel' | transloco }}
                          </button>

                          @if (draftCategory() !== status.category) {
                            <p class="basis-full text-meta text-warning-ink">
                              {{ 'admin.statuses.recategorise' | transloco }}
                            </p>
                          }
                        } @else {
                          <div class="min-w-0 flex-1">
                            <p class="flex items-center gap-2 truncate text-body font-semibold">
                              {{ status.name }}
                              @if (status.isDefault) {
                                <tk-badge tone="primary" [title]="'admin.statuses.defaultHint' | transloco">
                                  {{ 'admin.statuses.default' | transloco }}
                                </tk-badge>
                              }
                              @if (status.isSystem) {
                                <tk-badge tone="neutral">{{ 'admin.statuses.builtIn' | transloco }}</tk-badge>
                              }
                            </p>
                            <p class="truncate font-mono text-meta text-muted-foreground">{{ status.value }}</p>
                          </div>

                          @if (status.isActive && !status.isDefault) {
                            <button tkButton variant="ghost" size="sm" [disabled]="busy()" (click)="makeDefault(status)">
                              {{ 'admin.statuses.makeDefault' | transloco }}
                            </button>
                          }
                          <button tkButton variant="ghost" size="sm" [disabled]="busy()" (click)="startEdit(status)">
                            {{ 'common.edit' | transloco }}
                          </button>
                          <button
                            tkButton
                            variant="outline"
                            size="sm"
                            [disabled]="busy()"
                            (click)="setActive(status, !status.isActive)"
                          >
                            {{ (status.isActive ? 'admin.layout.hide' : 'admin.layout.show') | transloco }}
                          </button>
                          @if (!status.isSystem) {
                            <button
                              type="button"
                              class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                              [disabled]="busy()"
                              [attr.aria-label]="'common.delete' | transloco"
                              (click)="remove(status)"
                            >
                              <tk-icon name="trash-2" [size]="15" />
                            </button>
                          }
                        }
                      </li>
                    } @empty {
                      <li class="px-5 py-3 text-body text-muted-foreground">
                        {{ 'admin.statuses.empty' | transloco }}
                      </li>
                    }
                  </ul>

                  <div card-footer class="card-footer flex items-center gap-2">
                    <input
                      tkInput
                      inset
                      inputSize="sm"
                      class="min-w-0 flex-1"
                      [attr.placeholder]="'admin.statuses.addPlaceholder' | transloco"
                      [attr.aria-label]="addLabel(group.category)"
                      [ngModel]="drafts()[group.category] ?? ''"
                      (ngModelChange)="setDraft(group.category, $event)"
                      (keydown.enter)="add(group.category)"
                    />
                    <button
                      tkButton
                      variant="outline"
                      size="sm"
                      [disabled]="busy() || !(drafts()[group.category] ?? '').trim()"
                      (click)="add(group.category)"
                    >
                      <tk-icon name="plus" [size]="14" />
                      {{ 'admin.statuses.add' | transloco }}
                    </button>
                  </div>
                  </tk-card>
                </section>
              }

              @if (busy()) {
                <p class="flex items-center gap-2 text-meta text-muted-foreground">
                  <tk-spinner [size]="14" />
                  {{ 'common.loading' | transloco }}
                </p>
              }
            } @else if (statuses.error()) {
              <tk-alert tone="danger" [heading]="'admin.statuses.loadFailed' | transloco">
                {{ loadError() }}
                <button type="button" class="ml-1 font-semibold underline" (click)="statuses.reload()">
                  {{ 'common.retry' | transloco }}
                </button>
              </tk-alert>
            } @else {
              <span tkSkeleton class="h-96 w-full"></span>
            }
          }
        }
      </div>
    </div>
  `,
})
export class TicketStatusSettings {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly categories = STATUS_CATEGORIES;

  /** `includeInactive`, or a retired status could never be brought back. */
  protected readonly statuses = resource({
    loader: () => this.api.ticketStatuses(true),
  });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedStatuses = settled(() => this.statuses);

  protected readonly tab = signal('statuses');
  protected readonly busy = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly draftName = signal('');
  protected readonly draftCategory = signal<string>('open');
  /** One pending new-status name per category — each section has its own field. */
  protected readonly drafts = signal<Record<string, string>>({});

  protected readonly list = computed(() => valueOr(this.statuses, []));
  protected readonly loadError = computed(() => errorMessage(this.statuses.error()));

  /** What the workflow matrix draws. A retired status is not a destination. */
  protected readonly active = computed(() => this.list().filter((s) => s.isActive));

  protected readonly tabs = computed<TabItem[]>(() => [
    {
      id: 'statuses',
      label: this.transloco.translate('admin.statuses.tabStatuses'),
      icon: 'circle',
      count: this.active().length,
    },
    { id: 'workflow', label: this.transloco.translate('admin.statuses.tabWorkflow'), icon: 'workflow' },
  ]);

  /**
   * The five categories, always all five and always in Trackly's order — an
   * empty one still has to be there to be added to.
   */
  protected readonly groups = computed(() => {
    const all = this.list();
    return STATUS_CATEGORIES.map((category) => ({
      category,
      statuses: all
        .filter((s) => s.category === category)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    }));
  });

  protected tone(category: string) {
    return toneFor(STATUS_TONE, category);
  }

  protected categoryName(category: string): string {
    return this.transloco.translate(this.tone(category).labelKey);
  }

  /** What this category does to a ticket — the reason the section exists. */
  protected behaviour(category: StatusCategory): string {
    return this.transloco.translate(`admin.statuses.behaviour.${category}`);
  }

  protected addLabel(category: StatusCategory): string {
    return this.transloco.translate('admin.statuses.addTo', { category: this.categoryName(category) });
  }

  protected setDraft(category: string, name: string): void {
    this.drafts.update((drafts) => ({ ...drafts, [category]: name }));
  }

  protected async add(category: StatusCategory): Promise<void> {
    const name = (this.drafts()[category] ?? '').trim();
    if (!name || this.busy()) return;
    await this.write(
      () => this.api.createTicketStatus({ category, name }),
      'admin.statuses.created',
      () => this.setDraft(category, ''),
    );
  }

  protected startEdit(status: TicketStatus): void {
    this.draftName.set(status.name);
    this.draftCategory.set(status.category);
    this.editing.set(status.id);
  }

  protected async commit(status: TicketStatus): Promise<void> {
    const name = this.draftName().trim();
    const category = this.draftCategory();
    // An empty name would leave a row nobody can identify. Treated as a cancel
    // rather than an error — the admin already knows they cleared the field.
    if (!name || (name === status.name && category === status.category)) {
      this.editing.set(null);
      return;
    }
    this.editing.set(null);
    await this.write(() => this.api.updateTicketStatus(status.id, { name, category }), 'admin.statuses.saved');
  }

  protected async setActive(status: TicketStatus, isActive: boolean): Promise<void> {
    await this.write(() => this.api.updateTicketStatus(status.id, { isActive }), 'admin.statuses.saved');
  }

  protected async makeDefault(status: TicketStatus): Promise<void> {
    await this.write(() => this.api.updateTicketStatus(status.id, { isDefault: true }), 'admin.statuses.saved');
  }

  /**
   * Asks first: a delete takes the status out of every picker and out of the
   * workflow, and nothing on this screen puts it back.
   */
  protected async remove(status: TicketStatus): Promise<void> {
    const confirmed = await this.confirm.ask({
      heading: this.transloco.translate('admin.statuses.deleteHeading', { name: status.name }),
      message: this.transloco.translate('admin.statuses.deleteMessage'),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!confirmed) return;
    await this.write(() => this.api.deleteTicketStatus(status.id), 'admin.statuses.deleted');
  }

  /**
   * Swaps a row with its neighbour by exchanging the two `sortOrder` values.
   *
   * Two writes rather than renumbering the section: only two rows moved, and
   * rewriting all of them turns one misclick into a whole list to put back.
   *
   * Unless the two rows share an order — which the seeded statuses do, since
   * they all start at 0 and only diverge once a category has more than one.
   * Swapping equal numbers is a button that visibly does nothing, so that case
   * renumbers the section from the order now on screen and then moves the row.
   */
  protected async move(rows: readonly TicketStatus[], index: number, direction: -1 | 1): Promise<void> {
    const a = rows[index];
    const b = rows[index + direction];
    if (!a || !b || this.busy()) return;

    this.busy.set(true);
    try {
      if (a.sortOrder === b.sortOrder) {
        const reordered = [...rows];
        reordered.splice(index + direction, 0, ...reordered.splice(index, 1));
        for (const [position, status] of reordered.entries()) {
          if (status.sortOrder !== position) {
            await this.api.updateTicketStatus(status.id, { sortOrder: position });
          }
        }
        return;
      }
      await this.api.updateTicketStatus(a.id, { sortOrder: b.sortOrder });
      await this.api.updateTicketStatus(b.id, { sortOrder: a.sortOrder });
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      // Reloaded either way: on failure one of the two writes may have landed,
      // and the order on screen would otherwise be one the server never took.
      this.statuses.reload();
      this.busy.set(false);
    }
  }

  private async write(action: () => Promise<unknown>, successKey: string, onSuccess?: () => void): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      onSuccess?.();
      this.toast.success(this.transloco.translate(successKey));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.statuses.reload();
      this.busy.set(false);
    }
  }
}
