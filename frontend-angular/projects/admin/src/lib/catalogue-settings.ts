import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  TICKET_FIELD_TYPES,
  TicketsApi,
  errorMessage,
  fieldHasOptions,
  valueOr,
  type Asset,
  type BusinessService,
  type TicketField,
} from '@trackly/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmService,
  Icon,
  InputDirective,
  LabelDirective,
  Select,
  SelectOption,
  SkeletonDirective,
  Spinner,
  Tabs,
  ToastService,
  type TabItem,
} from '@trackly/ui';

/**
 * Admin → Registers: the asset list, the service catalogue, and the workspace's
 * own ticket properties.
 *
 * Three tabs rather than three routes because they are the same decision from
 * three angles — what this workspace tracks — and an admin setting one up
 * usually touches the next.
 *
 * **Retire, never delete, once anything references it.** A ticket pointing at a
 * row that is gone renders as a blank chip, which reads as a bug rather than as
 * history. The API refuses it; the button is hidden to save the round trip.
 */
@Component({
  selector: 'tk-admin-catalogue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    Checkbox,
    Icon,
    InputDirective,
    LabelDirective,
    Select,
    SelectOption,
    SkeletonDirective,
    Spinner,
    Tabs,
  ],
  template: `
    <div class="mx-auto max-w-[860px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.catalogue.title' | transloco }}</h1>
      <p class="mb-5 mt-1 text-body text-muted-foreground">{{ 'admin.catalogue.subtitle' | transloco }}</p>

      <tk-tabs class="mb-5" [tabs]="tabs()" [(active)]="tab" panelId="catalogue-panel" />

      <div id="catalogue-panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
        @switch (tab()) {
          <!-- ── Assets ─────────────────────────────────────────────────── -->
          @case ('assets') {
            @if (assets.value()) {
              <tk-card flush>
                <ul class="divide-y divide-border">
                  @for (asset of assetList(); track asset.id) {
                    <li class="flex flex-wrap items-center gap-3 px-5 py-3" [class.opacity-60]="!asset.isActive">
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-body font-semibold">{{ asset.name }}</p>
                        <p class="truncate text-meta text-muted-foreground">
                          {{ describe(asset) }}
                        </p>
                      </div>
                      @if (asset.ticketCount) {
                        <tk-badge tone="neutral">
                          {{ 'admin.catalogue.usedBy' | transloco: { count: asset.ticketCount } }}
                        </tk-badge>
                      }
                      <button
                        tkButton
                        variant="outline"
                        size="sm"
                        [disabled]="busy()"
                        (click)="setAssetActive(asset, !asset.isActive)"
                      >
                        {{ (asset.isActive ? 'admin.layout.hide' : 'admin.layout.show') | transloco }}
                      </button>
                      <!-- Hidden, not disabled: the API refuses it and a dead
                           button invites the click that finds that out. -->
                      @if (!asset.ticketCount) {
                        <button
                          type="button"
                          class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                          [disabled]="busy()"
                          [attr.aria-label]="'common.delete' | transloco"
                          (click)="removeAsset(asset)"
                        >
                          <tk-icon name="trash-2" [size]="15" />
                        </button>
                      }
                    </li>
                  } @empty {
                    <li class="px-5 py-4 text-body text-muted-foreground">
                      {{ 'admin.catalogue.noAssets' | transloco }}
                    </li>
                  }
                </ul>

                <div card-footer class="card-footer flex flex-wrap items-end gap-2">
                  <div class="min-w-0 flex-1">
                    <label tkLabel for="asset-name">{{ 'admin.catalogue.assetName' | transloco }}</label>
                    <input tkInput inset inputSize="sm" id="asset-name" class="w-full"
                           [(ngModel)]="assetName" (keydown.enter)="addAsset()" />
                  </div>
                  <div class="w-32">
                    <label tkLabel for="asset-kind">{{ 'admin.catalogue.assetKind' | transloco }}</label>
                    <input tkInput inset inputSize="sm" id="asset-kind" class="w-full" [(ngModel)]="assetKind" />
                  </div>
                  <div class="w-32">
                    <label tkLabel for="asset-tag">{{ 'admin.catalogue.assetTag' | transloco }}</label>
                    <input tkInput inset inputSize="sm" id="asset-tag" class="w-full" [(ngModel)]="assetTag" />
                  </div>
                  <button tkButton size="sm" [disabled]="busy() || !assetName().trim()" (click)="addAsset()">
                    <tk-icon name="plus" [size]="14" />
                    {{ 'admin.catalogue.add' | transloco }}
                  </button>
                </div>
              </tk-card>
            } @else {
              <span tkSkeleton class="block h-64 w-full"></span>
            }
          }

          <!-- ── Services ───────────────────────────────────────────────── -->
          @case ('services') {
            @if (services.value()) {
              <tk-card flush>
                <ul class="divide-y divide-border">
                  @for (service of serviceList(); track service.id) {
                    <li class="flex flex-wrap items-center gap-3 px-5 py-3" [class.opacity-60]="!service.isActive">
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-body font-semibold">{{ service.name }}</p>
                        <p class="truncate text-meta text-muted-foreground">
                          {{ service.description || service.ownerTeamName || '—' }}
                        </p>
                      </div>
                      @if (service.openTicketCount) {
                        <tk-badge tone="warning">
                          {{ 'admin.catalogue.openIncidents' | transloco: { count: service.openTicketCount } }}
                        </tk-badge>
                      }
                      <button
                        tkButton
                        variant="outline"
                        size="sm"
                        [disabled]="busy()"
                        (click)="setServiceActive(service, !service.isActive)"
                      >
                        {{ (service.isActive ? 'admin.layout.hide' : 'admin.layout.show') | transloco }}
                      </button>
                    </li>
                  } @empty {
                    <li class="px-5 py-4 text-body text-muted-foreground">
                      {{ 'admin.catalogue.noServices' | transloco }}
                    </li>
                  }
                </ul>

                <div card-footer class="card-footer flex flex-wrap items-end gap-2">
                  <div class="min-w-0 flex-1">
                    <label tkLabel for="service-name">{{ 'admin.catalogue.serviceName' | transloco }}</label>
                    <input tkInput inset inputSize="sm" id="service-name" class="w-full"
                           [(ngModel)]="serviceName" (keydown.enter)="addService()" />
                  </div>
                  <div class="w-44">
                    <label tkLabel for="service-owner">{{ 'admin.catalogue.owner' | transloco }}</label>
                    <tk-select inset size="sm" inputId="service-owner" [(value)]="serviceOwner">
                      <tk-option value="" [label]="'common.none' | transloco" />
                      @for (team of teamList(); track team.id) {
                        <tk-option [value]="team.id" [label]="team.name" />
                      }
                    </tk-select>
                  </div>
                  <button tkButton size="sm" [disabled]="busy() || !serviceName().trim()" (click)="addService()">
                    <tk-icon name="plus" [size]="14" />
                    {{ 'admin.catalogue.add' | transloco }}
                  </button>
                </div>
              </tk-card>
            } @else {
              <span tkSkeleton class="block h-64 w-full"></span>
            }
          }

          <!-- ── Custom properties ──────────────────────────────────────── -->
          @default {
            <p class="mb-4 flex items-start gap-2 text-meta text-muted-foreground">
              <tk-icon name="info" [size]="14" class="mt-0.5 shrink-0" />
              <span>{{ 'admin.catalogue.fieldsHint' | transloco }}</span>
            </p>

            @if (fields.value()) {
              <tk-card flush>
                <ul class="divide-y divide-border">
                  @for (field of fieldList(); track field.id) {
                    <li class="flex flex-wrap items-center gap-3 px-5 py-3" [class.opacity-60]="!field.isActive">
                      <div class="min-w-0 flex-1">
                        <p class="flex items-center gap-2 truncate text-body font-semibold">
                          {{ field.label }}
                          @if (field.isRequired) {
                            <tk-badge tone="warning">{{ 'admin.catalogue.required' | transloco }}</tk-badge>
                          }
                        </p>
                        <p class="truncate font-mono text-meta text-muted-foreground">
                          {{ field.key }} · {{ typeLabel(field.type) }}{{ optionSummary(field) }}
                        </p>
                      </div>
                      <button
                        tkButton
                        variant="outline"
                        size="sm"
                        [disabled]="busy()"
                        (click)="setFieldActive(field, !field.isActive)"
                      >
                        {{ (field.isActive ? 'admin.layout.hide' : 'admin.layout.show') | transloco }}
                      </button>
                      @if (!field.isActive) {
                        <button
                          type="button"
                          class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                          [disabled]="busy()"
                          [attr.aria-label]="'common.delete' | transloco"
                          (click)="removeField(field)"
                        >
                          <tk-icon name="trash-2" [size]="15" />
                        </button>
                      }
                    </li>
                  } @empty {
                    <li class="px-5 py-4 text-body text-muted-foreground">
                      {{ 'admin.catalogue.noFields' | transloco }}
                    </li>
                  }
                </ul>

                <div card-footer class="card-footer space-y-3">
                  <div class="flex flex-wrap items-end gap-2">
                    <div class="min-w-0 flex-1">
                      <label tkLabel for="field-label">{{ 'admin.catalogue.fieldLabel' | transloco }}</label>
                      <input tkInput inset inputSize="sm" id="field-label" class="w-full" [(ngModel)]="fieldLabel" />
                    </div>
                    <div class="w-36">
                      <label tkLabel for="field-type">{{ 'admin.catalogue.fieldType' | transloco }}</label>
                      <tk-select inset size="sm" inputId="field-type" [(value)]="fieldType">
                        @for (type of types; track type) {
                          <tk-option [value]="type" [label]="typeLabel(type)" />
                        }
                      </tk-select>
                    </div>
                    <tk-checkbox [(checked)]="fieldRequired">
                      {{ 'admin.catalogue.required' | transloco }}
                    </tk-checkbox>
                  </div>

                  <!-- Only for the types that have choices. Showing it always
                       would ask an admin to fill in a box that does nothing. -->
                  @if (needsOptions()) {
                    <div>
                      <label tkLabel for="field-options">{{ 'admin.catalogue.options' | transloco }}</label>
                      <textarea
                        tkInput
                        inset
                        id="field-options"
                        rows="3"
                        class="w-full"
                        [attr.placeholder]="'admin.catalogue.optionsPlaceholder' | transloco"
                        [(ngModel)]="fieldOptions"
                      ></textarea>
                      <tk-checkbox class="mt-2" [(checked)]="fieldAllowNew">
                        {{ 'admin.catalogue.allowNew' | transloco }}
                      </tk-checkbox>
                    </div>
                  }

                  <div class="flex items-center gap-2">
                    <button tkButton size="sm" [disabled]="busy() || !fieldLabel().trim()" (click)="addField()">
                      <tk-icon name="plus" [size]="14" />
                      {{ 'admin.catalogue.add' | transloco }}
                    </button>
                    @if (busy()) {
                      <tk-spinner [size]="14" />
                    }
                  </div>
                </div>
              </tk-card>
            } @else if (fields.error()) {
              <tk-alert tone="danger">{{ fieldError() }}</tk-alert>
            } @else {
              <span tkSkeleton class="block h-64 w-full"></span>
            }
          }
        }
      </div>
    </div>
  `,
})
export class CatalogueSettings {
  private readonly api = inject(TicketsApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly types = TICKET_FIELD_TYPES;
  protected readonly tab = signal('assets');
  protected readonly busy = signal(false);

  protected readonly assetName = signal('');
  protected readonly assetKind = signal('');
  protected readonly assetTag = signal('');
  protected readonly serviceName = signal('');
  protected readonly serviceOwner = signal('');
  protected readonly fieldLabel = signal('');
  protected readonly fieldType = signal<string>('text');
  protected readonly fieldOptions = signal('');
  protected readonly fieldAllowNew = signal(true);
  protected readonly fieldRequired = signal(false);

  /** `includeInactive`, or a retired row could never be brought back. */
  protected readonly assets = resource({ loader: () => this.api.assets(undefined, true) });
  protected readonly services = resource({ loader: () => this.api.services(true) });
  protected readonly fields = resource({ loader: () => this.api.ticketFields(true) });
  private readonly teams = resource({ loader: () => this.api.teams() });

  protected readonly assetList = computed(() => valueOr(this.assets, []));
  protected readonly serviceList = computed(() => valueOr(this.services, []));
  protected readonly fieldList = computed(() => valueOr(this.fields, []));
  protected readonly fieldError = computed(() => errorMessage(this.fields.error()));

  /** Departments only — a service is owned by a department, not a sub-team. */
  protected readonly teamList = computed(() => valueOr(this.teams, []).filter((t) => !t.parentId));

  protected readonly needsOptions = computed(() => fieldHasOptions(this.fieldType()));

  protected readonly tabs = computed<TabItem[]>(() => [
    {
      id: 'assets',
      label: this.transloco.translate('admin.catalogue.tabAssets'),
      icon: 'rocket',
      count: this.assetList().length || undefined,
    },
    {
      id: 'services',
      label: this.transloco.translate('admin.catalogue.tabServices'),
      icon: 'globe',
      count: this.serviceList().length || undefined,
    },
    {
      id: 'fields',
      label: this.transloco.translate('admin.catalogue.tabFields'),
      icon: 'sliders-horizontal',
      count: this.fieldList().length || undefined,
    },
  ]);

  protected describe(asset: Asset): string {
    return [asset.kind, asset.tag, asset.location].filter(Boolean).join(' · ') || '—';
  }

  protected typeLabel(type: string): string {
    const key = `admin.catalogue.types.${type}`;
    const text = this.transloco.translate(key);
    return text === key ? type : text;
  }

  /** " · 4 choices" — or nothing at all for a type that has none. */
  protected optionSummary(field: TicketField): string {
    if (!fieldHasOptions(field.type)) return '';
    return ` · ${this.transloco.translate('admin.catalogue.choiceCount', { count: field.options.length })}`;
  }

  // ---- Assets ----

  protected async addAsset(): Promise<void> {
    const name = this.assetName().trim();
    if (!name || this.busy()) return;
    await this.write(
      () =>
        this.api.createAsset({
          name,
          kind: this.assetKind().trim() || null,
          tag: this.assetTag().trim() || null,
        }),
      this.assets,
    );
    this.assetName.set('');
    this.assetKind.set('');
    this.assetTag.set('');
  }

  protected async setAssetActive(asset: Asset, isActive: boolean): Promise<void> {
    await this.write(() => this.api.updateAsset(asset.id, { isActive }), this.assets);
  }

  protected async removeAsset(asset: Asset): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('admin.catalogue.deleteAsset', { name: asset.name }),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    await this.write(() => this.api.deleteAsset(asset.id), this.assets);
  }

  // ---- Services ----

  protected async addService(): Promise<void> {
    const name = this.serviceName().trim();
    if (!name || this.busy()) return;
    await this.write(
      () => this.api.createService({ name, ownerTeamId: this.serviceOwner() || null }),
      this.services,
    );
    this.serviceName.set('');
    this.serviceOwner.set('');
  }

  protected async setServiceActive(service: BusinessService, isActive: boolean): Promise<void> {
    await this.write(() => this.api.updateService(service.id, { isActive }), this.services);
  }

  // ---- Custom properties ----

  protected async addField(): Promise<void> {
    const label = this.fieldLabel().trim();
    if (!label || this.busy()) return;
    await this.write(
      () =>
        this.api.createTicketField({
          label,
          type: this.fieldType(),
          options: this.needsOptions() ? this.fieldOptions() || null : null,
          allowNewOptions: this.needsOptions() ? this.fieldAllowNew() : false,
          isRequired: this.fieldRequired(),
        }),
      this.fields,
    );
    this.fieldLabel.set('');
    this.fieldOptions.set('');
    this.fieldRequired.set(false);
  }

  protected async setFieldActive(field: TicketField, isActive: boolean): Promise<void> {
    await this.write(() => this.api.updateTicketField(field.id, { isActive }), this.fields);
  }

  protected async removeField(field: TicketField): Promise<void> {
    const ok = await this.confirm.ask({
      heading: this.transloco.translate('admin.catalogue.deleteField', { name: field.label }),
      message: this.transloco.translate('admin.catalogue.deleteFieldHint'),
      confirmLabel: this.transloco.translate('common.delete'),
      tone: 'danger',
    });
    if (!ok) return;
    await this.write(() => this.api.deleteTicketField(field.id), this.fields);
  }

  private async write(
    action: () => Promise<unknown>,
    target: { reload: () => void },
  ): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      target.reload();
      this.busy.set(false);
    }
  }
}
