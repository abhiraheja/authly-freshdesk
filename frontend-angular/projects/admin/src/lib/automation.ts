import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
    AUTOMATION_ACTIONS,
  AUTOMATION_FIELDS,
  AUTOMATION_OPS,
  AUTOMATION_TRIGGERS,
  settled,
  WorkspaceOpsApi,
  errorMessage,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule,
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
  Switch,
  TableDirective,
  ToastService,
} from '@trackly/ui';

/**
 * Automation rules — the conditions Trackly checks inside every ticket create
 * and update, and what it does when they all match.
 *
 * Three things about the model that the editor has to say out loud, because
 * getting any of them wrong produces a rule that looks right and behaves
 * differently:
 *
 * - **Conditions are ANDed.** There is no "any of these"; a rule with two
 *   conditions fires when both hold.
 * - **Rules run in order**, lowest number first, and a later rule sees what an
 *   earlier one did.
 * - **A rule's own changes are not re-evaluated**, so rules cannot trigger each
 *   other and there is no loop to reason about.
 *
 * The editor is a drawer over the list for the usual reason: a new rule is
 * written while looking at the ones that already run, because the order and the
 * overlap are the parts that are easy to get wrong.
 */
@Component({
  selector: 'tk-automation',
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
    Switch,
    TableDirective,
  ],
  template: `
    <tk-page-header [title]="'automation.title' | transloco" [subtitle]="'automation.subtitle' | transloco">
      <button tkButton page-actions (click)="startCreate()">
        <tk-icon name="plus" [size]="16" />
        {{ 'automation.add' | transloco }}
      </button>
    </tk-page-header>

    @if (loadedRules()) {
      <tk-card flush>
        <div class="overflow-x-auto">
          <table tkTable hover class="min-w-[880px]">
            <thead>
              <tr>
                <th scope="col" class="w-[5rem] col-right">{{ 'automation.columns.order' | transloco }}</th>
                <th scope="col">{{ 'automation.columns.rule' | transloco }}</th>
                <th scope="col" class="w-[10rem]">{{ 'automation.columns.trigger' | transloco }}</th>
                <th scope="col" class="w-[8rem]">{{ 'automation.columns.enabled' | transloco }}</th>
                <th scope="col" class="w-[7rem] col-right">
                  <span class="sr-only">{{ 'common.actions' | transloco }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (rule of rows(); track rule.id) {
                <tr class="cursor-pointer" (click)="startEdit(rule)">
                  <td class="col-right font-mono text-meta text-muted-foreground">{{ rule.sortOrder }}</td>
                  <td class="max-w-0">
                    <span class="block truncate font-semibold" [class.text-muted-foreground]="!rule.enabled">
                      {{ rule.name }}
                    </span>
                    <!-- The rule in words. A row that only showed a name would
                         make an admin open every one of them to find the one
                         that is doing the surprising thing. -->
                    <span class="block truncate text-meta text-muted-foreground">{{ summary(rule) }}</span>
                  </td>
                  <td>
                    <tk-badge tone="neutral">{{ 'automation.triggers.' + rule.trigger | transloco }}</tk-badge>
                  </td>
                  <td (click)="$event.stopPropagation()">
                    <tk-switch
                      [checked]="rule.enabled"
                      [disabled]="busy()"
                      [ariaLabel]="'automation.toggleOne' | transloco: { name: rule.name }"
                      (checkedChange)="toggle(rule, $event)"
                    />
                  </td>
                  <td class="col-right">
                    <span class="row-actions flex justify-end gap-1">
                      <button
                        tkButton
                        variant="ghost"
                        size="sm"
                        iconOnly
                        [attr.aria-label]="'automation.editOne' | transloco: { name: rule.name }"
                        (click)="$event.stopPropagation(); startEdit(rule)"
                      >
                        <tk-icon name="pencil" [size]="16" />
                      </button>
                      <button
                        tkButton
                        variant="ghost"
                        size="sm"
                        iconOnly
                        class="text-danger"
                        [attr.aria-label]="'automation.deleteOne' | transloco: { name: rule.name }"
                        (click)="$event.stopPropagation(); remove(rule)"
                      >
                        <tk-icon name="trash-2" [size]="16" />
                      </button>
                    </span>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="p-0">
                    <tk-empty-state
                      icon="workflow"
                      [heading]="'automation.empty' | transloco"
                      [description]="'automation.emptyBody' | transloco"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </tk-card>
    } @else if (rules.error()) {
      <tk-alert tone="danger" [heading]="'automation.loadFailed' | transloco">
        {{ loadError() }}
        <button type="button" class="ml-1 font-semibold underline" (click)="rules.reload()">
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
      <div class="space-y-5">
        <div>
          <label tkLabel for="rule-name">{{ 'automation.form.name' | transloco }}</label>
          <input
            tkInput
            id="rule-name"
            name="rule-name"
            maxlength="120"
            [placeholder]="'automation.form.namePlaceholder' | transloco"
            [(ngModel)]="draftName"
          />
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label tkLabel for="rule-trigger">{{ 'automation.form.trigger' | transloco }}</label>
            <tk-select inputId="rule-trigger" [(value)]="draftTrigger">
              @for (trigger of triggers; track trigger) {
                <tk-option [value]="trigger" [label]="'automation.triggers.' + trigger | transloco" />
              }
            </tk-select>
          </div>
          <div>
            <label tkLabel for="rule-order">{{ 'automation.form.order' | transloco }}</label>
            <input tkInput id="rule-order" name="rule-order" type="number" min="0" [(ngModel)]="draftOrder" />
            <p class="mt-1.5 text-meta text-muted-foreground">{{ 'automation.form.orderHint' | transloco }}</p>
          </div>
        </div>

        <!-- Conditions -->
        <div>
          <p class="mb-1.5 text-meta font-semibold">{{ 'automation.form.conditions' | transloco }}</p>
          <p class="mb-2 text-meta text-muted-foreground">{{ 'automation.form.conditionsHint' | transloco }}</p>

          <div class="space-y-2">
            @for (condition of draftConditions(); track $index) {
              <div class="flex flex-wrap items-center gap-2">
                <tk-select
                  auto
                  size="sm"
                  [ariaLabel]="'automation.form.field' | transloco"
                  [value]="condition.field"
                  (valueChange)="setCondition($index, { field: $event })"
                >
                  @for (field of fields; track field) {
                    <tk-option [value]="field" [label]="'automation.fields.' + field | transloco" />
                  }
                </tk-select>
                <tk-select
                  auto
                  size="sm"
                  [ariaLabel]="'automation.form.operator' | transloco"
                  [value]="condition.op"
                  (valueChange)="setCondition($index, { op: $event })"
                >
                  @for (op of ops; track op) {
                    <tk-option [value]="op" [label]="'automation.ops.' + op | transloco" />
                  }
                </tk-select>
                <input
                  tkInput
                  inputSize="sm"
                  class="min-w-[8rem] flex-1"
                  [attr.aria-label]="'automation.form.value' | transloco"
                  [ngModel]="condition.value ?? ''"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="setCondition($index, { value: $event })"
                />
                <button
                  tkButton
                  variant="ghost"
                  size="sm"
                  iconOnly
                  [attr.aria-label]="'automation.form.removeCondition' | transloco"
                  (click)="removeCondition($index)"
                >
                  <tk-icon name="x" [size]="16" />
                </button>
              </div>
            }
          </div>

          <button tkButton variant="ghost" size="sm" class="mt-2" (click)="addCondition()">
            <tk-icon name="plus" [size]="14" />
            {{ 'automation.form.addCondition' | transloco }}
          </button>
          @if (!draftConditions().length) {
            <p class="mt-1.5 text-meta text-warning-ink">{{ 'automation.form.noConditions' | transloco }}</p>
          }
        </div>

        <!-- Actions -->
        <div>
          <p class="mb-1.5 text-meta font-semibold">{{ 'automation.form.actions' | transloco }}</p>

          <div class="space-y-2">
            @for (action of draftActions(); track $index) {
              <div class="flex flex-wrap items-center gap-2">
                <tk-select
                  auto
                  size="sm"
                  [ariaLabel]="'automation.form.action' | transloco"
                  [value]="action.type"
                  (valueChange)="setAction($index, { type: $event })"
                >
                  @for (type of actionTypes; track type) {
                    <tk-option [value]="type" [label]="'automation.actions.' + type | transloco" />
                  }
                </tk-select>
                <input
                  tkInput
                  inputSize="sm"
                  class="min-w-[8rem] flex-1"
                  [attr.aria-label]="'automation.form.value' | transloco"
                  [placeholder]="actionHint(action)"
                  [ngModel]="action.value ?? ''"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="setAction($index, { value: $event })"
                />
                <button
                  tkButton
                  variant="ghost"
                  size="sm"
                  iconOnly
                  [attr.aria-label]="'automation.form.removeAction' | transloco"
                  (click)="removeAction($index)"
                >
                  <tk-icon name="x" [size]="16" />
                </button>
              </div>
            }
          </div>

          <button tkButton variant="ghost" size="sm" class="mt-2" (click)="addAction()">
            <tk-icon name="plus" [size]="14" />
            {{ 'automation.form.addAction' | transloco }}
          </button>
        </div>

        <label class="flex items-center gap-2">
          <tk-switch [(checked)]="draftEnabled" [ariaLabel]="'automation.form.enabled' | transloco" />
          <span class="text-body">{{ 'automation.form.enabled' | transloco }}</span>
        </label>

        @if (saveError(); as message) {
          <tk-alert tone="danger" [heading]="'automation.saveFailed' | transloco">{{ message }}</tk-alert>
        }
      </div>

      <div drawer-footer class="flex justify-end gap-2">
        <button tkButton variant="ghost" (click)="editorOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
        <button tkButton [disabled]="!canSave()" (click)="save()">{{ 'common.save' | transloco }}</button>
      </div>
    </tk-drawer>
  `,
})
export class Automation {
  private readonly api = inject(WorkspaceOpsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly skeletonRows = [0, 1, 2];
  protected readonly triggers = AUTOMATION_TRIGGERS;
  protected readonly fields = AUTOMATION_FIELDS;
  protected readonly ops = AUTOMATION_OPS;
  protected readonly actionTypes = AUTOMATION_ACTIONS;

  protected readonly rules = resource({ loader: () => this.api.automationRules() });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedRules = settled(() => this.rules);
  protected readonly rows = computed(() => this.loadedRules() ?? []);
  protected readonly loadError = computed(() => errorMessage(this.rules.error()));

  protected readonly busy = signal(false);
  protected readonly editorOpen = signal(false);
  private readonly editing = signal<AutomationRule | null>(null);

  protected readonly draftName = signal('');
  protected readonly draftTrigger = signal<string>('on_create');
  protected readonly draftOrder = signal(0);
  protected readonly draftEnabled = signal(true);
  protected readonly draftConditions = signal<readonly AutomationCondition[]>([]);
  protected readonly draftActions = signal<readonly AutomationAction[]>([]);
  protected readonly saveError = signal<string | null>(null);

  protected readonly canSave = computed(
    () => !this.busy() && this.draftName().trim().length > 0 && this.draftActions().length > 0,
  );

  protected readonly editorHeading = computed(() =>
    this.transloco.translate(this.editing() ? 'automation.editHeading' : 'automation.newHeading'),
  );

  /**
   * The rule as a sentence, for the list.
   *
   * Assembled from already-translated fragments, which the i18n rule normally
   * forbids — but this is a formal expression rather than prose: it renders the
   * same shape in every language because it is describing a machine, and there
   * is no word order for "priority equals urgent → add tag" to get wrong.
   */
  protected summary(rule: AutomationRule): string {
    const when = rule.conditions.length
      ? rule.conditions
          .map(
            (condition) =>
              `${this.transloco.translate('automation.fields.' + condition.field)} ` +
              `${this.transloco.translate('automation.ops.' + condition.op)} ` +
              `${condition.value ?? ''}`.trim(),
          )
          .join(' · ')
      : this.transloco.translate('automation.everyTicket');

    const then = rule.actions
      .map(
        (action) =>
          `${this.transloco.translate('automation.actions.' + action.type)}` +
          (action.value ? ` ${action.value}` : ''),
      )
      .join(' · ');

    return `${when} → ${then}`;
  }

  protected actionHint(action: AutomationAction): string {
    return this.transloco.translate(`automation.actionHints.${action.type}`);
  }

  protected startCreate(): void {
    this.editing.set(null);
    this.draftName.set('');
    this.draftTrigger.set('on_create');
    // Below every existing rule: a new rule that silently jumped the queue could
    // change what the ones after it see.
    this.draftOrder.set(this.rows().length);
    this.draftEnabled.set(true);
    this.draftConditions.set([]);
    this.draftActions.set([{ type: 'set_priority', value: '' }]);
    this.saveError.set(null);
    this.editorOpen.set(true);
  }

  protected startEdit(rule: AutomationRule): void {
    this.editing.set(rule);
    this.draftName.set(rule.name);
    this.draftTrigger.set(rule.trigger);
    this.draftOrder.set(rule.sortOrder);
    this.draftEnabled.set(rule.enabled);
    this.draftConditions.set(rule.conditions.map((condition) => ({ ...condition })));
    this.draftActions.set(rule.actions.map((action) => ({ ...action })));
    this.saveError.set(null);
    this.editorOpen.set(true);
  }

  protected addCondition(): void {
    this.draftConditions.update((current) => [...current, { field: 'priority', op: 'equals', value: '' }]);
  }

  protected setCondition(index: number, patch: Partial<AutomationCondition>): void {
    this.draftConditions.update((current) =>
      current.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)),
    );
  }

  protected removeCondition(index: number): void {
    this.draftConditions.update((current) => current.filter((_, i) => i !== index));
  }

  protected addAction(): void {
    this.draftActions.update((current) => [...current, { type: 'add_tag', value: '' }]);
  }

  protected setAction(index: number, patch: Partial<AutomationAction>): void {
    this.draftActions.update((current) =>
      current.map((action, i) => (i === index ? { ...action, ...patch } : action)),
    );
  }

  protected removeAction(index: number): void {
    this.draftActions.update((current) => current.filter((_, i) => i !== index));
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;

    const body = {
      name: this.draftName().trim(),
      trigger: this.draftTrigger(),
      conditions: this.draftConditions().map((condition) => ({
        ...condition,
        value: condition.value?.trim() || null,
      })),
      actions: this.draftActions().map((action) => ({
        ...action,
        value: action.value?.trim() || null,
      })),
      enabled: this.draftEnabled(),
      sortOrder: Number(this.draftOrder()) || 0,
    };

    const existing = this.editing();
    this.busy.set(true);
    this.saveError.set(null);
    try {
      if (existing) await this.api.updateAutomationRule(existing.id, body);
      else await this.api.createAutomationRule(body);

      this.editorOpen.set(false);
      this.rules.reload();
      this.toast.success(this.transloco.translate('automation.saved', { name: body.name }));
    } catch (error) {
      this.saveError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * The switch writes straight through — a rule that is off is the safe state,
   * and making somebody open an editor to stop a misbehaving rule is the wrong
   * amount of friction on the control they reach for when it is misfiring.
   */
  protected async toggle(rule: AutomationRule, enabled: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.updateAutomationRule(rule.id, { ...rule, enabled });
      this.rules.reload();
    } catch (error) {
      this.toast.error(errorMessage(error));
      this.rules.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(rule: AutomationRule): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('automation.deleteHeading'),
      message: this.transloco.translate('automation.deleteMessage', { name: rule.name }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;

    this.busy.set(true);
    try {
      await this.api.deleteAutomationRule(rule.id);
      this.rules.reload();
      this.toast.success(this.transloco.translate('automation.deleted', { name: rule.name }));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
