import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TicketsApi, errorMessage, type TicketOption } from '@trackly/core';
import { Tabs, ToastService, type TabItem } from '@trackly/ui';
import { ConfigList, type ConfigRow } from './config-list';

/** Which of the four lists a row belongs to — each has its own endpoints. */
type ConfigListKey = 'department' | 'category' | 'priority' | 'channel';

/**
 * Admin → Configuration: the four vocabularies a ticket is filed against.
 *
 * They live on four different endpoints with four different rules, so this page
 * owns every write and hands {@link ConfigList} nothing but rows and callbacks.
 *
 * The rules that differ, and why:
 *
 * - **Departments** route as well as label — a ticket filed into one is
 *   round-robin'd within its members — so deleting one is allowed but is a real
 *   change, not a tidy-up.
 * - **Categories** are pure labels. Delete freely.
 * - **Priorities and channels** carry their value on every ticket that used
 *   them, so a used one can only be deactivated. The server enforces that and
 *   returns a message saying so; this page shows the server's words rather than
 *   guessing at them, because the server is the one that knows what is in use.
 */
@Component({
  selector: 'tk-admin-configuration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ConfigList, Tabs],
  template: `
    <div class="mx-auto max-w-[860px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.config.title' | transloco }}</h1>
      <p class="mb-6 mt-1 text-body text-muted-foreground">{{ 'admin.config.subtitle' | transloco }}</p>

      <tk-tabs class="mb-5" [tabs]="tabs()" [active]="tab()" (activeChange)="onTabChange($event)" panelId="config-panel" />

      <!-- One card at a time, so each list gets the full width and the page
           stops being a scroll. The active tab lives in the query string, so
           "the Channels tab" is a link you can send someone and Back works. -->
      <div id="config-panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
        @switch (tab()) {
          @case ('department') {
            <tk-config-list
              [heading]="'admin.config.departments' | transloco"
              [description]="'admin.config.departmentsHelp' | transloco"
              [addPlaceholder]="'admin.config.departmentsAdd' | transloco"
              [rows]="departmentRows()"
              [loading]="teams.isLoading()"
              [error]="errorOf(teams)"
              [busy]="busy()"
              (retry)="teams.reload()"
              (add)="add('department', $event)"
              (rename)="rename('department', $event.row, $event.label)"
              (remove)="remove('department', $event)"
            />
          }
          @case ('category') {
            <tk-config-list
              [heading]="'admin.config.categories' | transloco"
              [description]="'admin.config.categoriesHelp' | transloco"
              [addPlaceholder]="'admin.config.categoriesAdd' | transloco"
              [rows]="categoryRows()"
              [loading]="categories.isLoading()"
              [error]="errorOf(categories)"
              [busy]="busy()"
              (retry)="categories.reload()"
              (add)="add('category', $event)"
              (rename)="rename('category', $event.row, $event.label)"
              (remove)="remove('category', $event)"
            />
          }
          @case ('priority') {
            <tk-config-list
              [heading]="'admin.config.priorities' | transloco"
              [description]="'admin.config.prioritiesHelp' | transloco"
              [addPlaceholder]="'admin.config.prioritiesAdd' | transloco"
              [rows]="optionRows(priorities.value())"
              [loading]="priorities.isLoading()"
              [error]="errorOf(priorities)"
              [busy]="busy()"
              (retry)="priorities.reload()"
              (add)="add('priority', $event)"
              (rename)="rename('priority', $event.row, $event.label)"
              (setActive)="setActive('priority', $event.row, $event.isActive)"
              (remove)="remove('priority', $event)"
            />
          }
          @default {
            <tk-config-list
              [heading]="'admin.config.channels' | transloco"
              [description]="'admin.config.channelsHelp' | transloco"
              [addPlaceholder]="'admin.config.channelsAdd' | transloco"
              [rows]="optionRows(channels.value())"
              [loading]="channels.isLoading()"
              [error]="errorOf(channels)"
              [busy]="busy()"
              (retry)="channels.reload()"
              (add)="add('channel', $event)"
              (rename)="rename('channel', $event.row, $event.label)"
              (setActive)="setActive('channel', $event.row, $event.isActive)"
              (remove)="remove('channel', $event)"
            />
          }
        }
      </div>
    </div>
  `,
})
export class AdminConfiguration {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);

  protected readonly teams = resource({ loader: () => this.api.teams() });
  protected readonly categories = resource({ loader: () => this.api.categories() });
  // includeInactive: the admin screen is the only place a retired option can be
  // brought back, so it has to be able to see one.
  protected readonly priorities = resource({ loader: () => this.api.ticketOptions('priority', true) });
  protected readonly channels = resource({ loader: () => this.api.ticketOptions('channel', true) });

  protected readonly busy = signal(false);

  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);

  /**
   * Bound from `?tab=`. An absent param arrives as undefined, not as the
   * declared default, so the transform normalises it — the same trap the ticket
   * list hit.
   */
  readonly tabParam = input('department', { transform: (value?: string) => value || 'department' });

  /** Local mirror, so the tab rail can write to it and an effect syncs the URL. */
  protected readonly tab = signal('department');

  constructor() {
    effect(() => this.tab.set(this.tabParam()));
  }

  protected onTabChange(next: string): void {
    this.tab.set(next);
    void this.router.navigate([], {
      queryParams: { tab: next === 'department' ? null : next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected readonly tabs = computed<TabItem[]>(() => {
    const t = (key: string) => this.transloco.translate('admin.config.' + key);
    return [
      { id: 'department', label: t('departments'), icon: 'user-cog', count: this.departmentRows().length },
      { id: 'category', label: t('categories'), icon: 'tag', count: this.categoryRows().length },
      { id: 'priority', label: t('priorities'), icon: 'alert-triangle', count: this.priorities.value()?.length },
      { id: 'channel', label: t('channels'), icon: 'message-circle', count: this.channels.value()?.length },
    ];
  });

  /**
   * A list that has not loaded yet has no error to report — only a settled
   * failure does. Without the isLoading guard the card would flash its error
   * state on the way in.
   */
  protected errorOf(list: { error: () => unknown; isLoading: () => boolean }): string | null {
    return !list.isLoading() && list.error() ? errorMessage(list.error()) : null;
  }

  protected readonly departmentRows = computed<ConfigRow[]>(() =>
    (this.teams.value() ?? []).map((team) => ({
      id: team.id,
      label: team.name,
      meta: team.members.length ? `${team.members.length}` : undefined,
      canRename: true,
      canDeactivate: false,
      canDelete: true,
    })),
  );

  protected readonly categoryRows = computed<ConfigRow[]>(() =>
    (this.categories.value() ?? []).map((category) => ({
      id: category.id,
      label: category.name,
      color: category.color,
      canRename: true,
      canDeactivate: false,
      canDelete: true,
    })),
  );

  /**
   * The stored value is shown as secondary text on purpose. It is what
   * automation rules match and what sits on every ticket, and it does NOT
   * change when the label is renamed — an admin writing a rule needs to see it.
   */
  protected optionRows(options: TicketOption[] | undefined): ConfigRow[] {
    return (options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      meta: option.value,
      color: option.color,
      isActive: option.isActive,
      canRename: true,
      canDeactivate: true,
      // Built-ins are never deletable. Used ones are refused by the server —
      // hiding the button here too would be a guess, since this page doesn't
      // know what is in use.
      canDelete: !option.isSystem,
    }));
  }

  protected add(list: ConfigListKey, label: string): void {
    const call =
      list === 'department' ? this.api.createTeam(label)
      : list === 'category' ? this.api.createCategory({ name: label })
      : this.api.createTicketOption({ kind: list, label });
    void this.run(list, call);
  }

  protected rename(list: ConfigListKey, row: ConfigRow, label: string): void {
    const call =
      list === 'department' ? this.api.renameTeam(row.id, label)
      : list === 'category' ? this.api.updateCategory(row.id, { name: label })
      : this.api.updateTicketOption(row.id, { label });
    void this.run(list, call);
  }

  protected setActive(list: ConfigListKey, row: ConfigRow, isActive: boolean): void {
    void this.run(list, this.api.updateTicketOption(row.id, { isActive }));
  }

  protected remove(list: ConfigListKey, row: ConfigRow): void {
    const call =
      list === 'department' ? this.api.deleteTeam(row.id)
      : list === 'category' ? this.api.deleteCategory(row.id)
      : this.api.deleteTicketOption(row.id);
    void this.run(list, call);
  }

  /**
   * Every mutation lands here: await it, reload only the list it touched, and
   * surface the server's own message on failure.
   *
   * Showing the server's text matters for these lists — "Tickets already use
   * this option, deactivate it instead" tells the admin exactly what to do,
   * where a generic "Couldn't delete" leaves them clicking the same button.
   */
  private async run(list: ConfigListKey, call: Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await call;
      this.resourceFor(list).reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private resourceFor(list: ConfigListKey): { reload: () => void } {
    switch (list) {
      case 'department':
        return this.teams;
      case 'category':
        return this.categories;
      case 'priority':
        return this.priorities;
      default:
        return this.channels;
    }
  }
}
