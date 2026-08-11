import { ChangeDetectionStrategy, Component, computed, inject, resource, signal, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  settled,
    SsoApi,
  errorMessage,
  formatDateTime,
  type SsoCatalogueEntry,
  type SsoConnection,
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
  ProviderMark,
  SkeletonDirective,
  Spinner,
  Switch,
  ToastService,
} from '@trackly/ui';
import { SsoConnectionForm } from './sso-connection-form';

/**
 * Admin → Single sign-on.
 *
 * A workspace offers a *list* of providers, not one: Google for customers and
 * Entra for staff is an ordinary setup, and each carries its own secret, its own
 * audience and its own status.
 *
 * **There is no Test button, deliberately.** An SSO flow signs you in — there is
 * no way to exercise it without actually doing it, and a green tick that only
 * proves a discovery document parsed is worse than no tick at all. So a
 * connection stays "not used yet" until a real login lands, and that is exactly
 * the fact invariant 8 counts before it will let another method be switched off.
 */
@Component({
  selector: 'tk-admin-sso-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoPipe,
    Alert,
    Badge,
    Button,
    Card,
    Drawer,
    EmptyState,
    Icon,
    ProviderMark,
    SkeletonDirective,
    Spinner,
    Switch,
    SsoConnectionForm,
  ],
  template: `
    <div class="mx-auto max-w-[860px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.sso.title' | transloco }}</h1>
      <p class="mb-6 mt-1 text-body text-muted-foreground">{{ 'admin.sso.subtitle' | transloco }}</p>

      @if (loadedSettings(); as saved) {
        <div class="space-y-4">
          <tk-card [heading]="'admin.sso.connections' | transloco" flush>
            @if (saved.connections.length) {
              <ul class="divide-y divide-border">
                @for (connection of saved.connections; track connection.id) {
                  <li class="flex flex-wrap items-center gap-3 p-4">
                    <tk-provider-mark [name]="connection.provider" [size]="24" class="text-primary" />

                    <div class="min-w-0 flex-1">
                      <p class="flex flex-wrap items-center gap-2 font-semibold">
                        {{ connection.providerName }}
                        <tk-badge [tone]="statusTone(connection)" dot>{{ statusLabel(connection) | transloco }}</tk-badge>
                      </p>
                      <p class="mt-0.5 text-meta text-muted-foreground">
                        {{ audienceLabel(connection) | transloco }} · {{ protocolName(connection.protocol) }}
                        @if (connection.testedAt) {
                          · {{ 'admin.sso.lastUsed' | transloco: { date: when(connection.testedAt) } }}
                        }
                      </p>
                    </div>

                    <tk-switch
                      [checked]="connection.isEnabled"
                      [disabled]="busyId() === connection.id"
                      [ariaLabel]="'admin.sso.enabled' | transloco"
                      (checkedChange)="setEnabled(connection, $event)"
                    />

                    <a
                      tkButton
                      variant="ghost"
                      size="sm"
                      target="_blank"
                      rel="noopener"
                      [href]="connection.startUrl"
                    >
                      <tk-icon name="external-link" [size]="15" />
                      {{ 'admin.sso.tryIt' | transloco }}
                    </a>

                    <button tkButton variant="outline" size="sm" (click)="edit(connection)">
                      {{ 'common.edit' | transloco }}
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <tk-empty-state
                icon="shield-check"
                [heading]="'admin.sso.emptyHeading' | transloco"
                [description]="'admin.sso.emptyBody' | transloco"
              />
            }
          </tk-card>

          <tk-card [heading]="'admin.sso.addProvider' | transloco" [subheading]="'admin.sso.addProviderHint' | transloco">
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              @for (entry of saved.catalogue; track entry.provider) {
                @let taken = isConfigured(entry, saved.connections);
                <button
                  type="button"
                  class="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:shadow-none"
                  [disabled]="taken"
                  (click)="add(entry)"
                >
                  <tk-provider-mark [name]="entry.provider" [size]="26" class="text-primary" />
                  <span class="font-semibold">{{ entry.displayName }}</span>
                  <span class="text-meta text-muted-foreground">
                    {{ (taken ? 'admin.sso.alreadyAdded' : protocolHint(entry)) | transloco }}
                  </span>
                </button>
              }
            </div>
          </tk-card>

          <tk-alert tone="info" [heading]="'admin.sso.rolesHeading' | transloco">
            {{ 'admin.sso.rolesBody' | transloco }}
          </tk-alert>

          <!-- Inside the data branch on purpose: resource.value() throws while
               the resource is in its error state, and the drawer reads the
               redirect URI straight off it. -->
          <tk-drawer [(open)]="drawerOpen" [heading]="drawerHeading()">
            @if (editingEntry(); as entry) {
              <tk-sso-connection-form
                [entry]="entry"
                [connection]="editingConnection()"
                [redirectUri]="saved.redirectUri"
                [samlAcsUrl]="saved.samlAcsUrl"
              />
            }

            <div drawer-footer class="flex w-full flex-wrap items-center gap-2">
              @if (editingConnection()) {
                <button tkButton variant="danger" [disabled]="saving()" (click)="remove()">
                  {{ 'admin.sso.disconnect' | transloco }}
                </button>
              }
              <span class="flex-1"></span>
              <button tkButton variant="ghost" (click)="drawerOpen.set(false)">{{ 'common.cancel' | transloco }}</button>
              <button tkButton [disabled]="saving()" (click)="save()">
                @if (saving()) {
                  <tk-spinner [size]="16" />
                }
                {{ 'common.save' | transloco }}
              </button>
            </div>
          </tk-drawer>
        </div>
      } @else if (settings.error()) {
        <tk-alert tone="danger" [heading]="'admin.sso.loadFailed' | transloco">
          {{ errorText() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="settings.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <div class="space-y-4">
          <span tkSkeleton class="h-48 w-full"></span>
          <span tkSkeleton class="h-40 w-full"></span>
        </div>
      }
    </div>
  `,
})
export class AdminSsoSettings {
  private readonly api = inject(SsoApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  protected readonly settings = resource({ loader: () => this.api.settings() });

  /** Never `.value()` directly: it throws in the error state and blanks the page. */
  protected readonly loadedSettings = settled(() => this.settings);

  protected readonly drawerOpen = signal(false);
  protected readonly editingEntry = signal<SsoCatalogueEntry | null>(null);
  protected readonly editingConnection = signal<SsoConnection | null>(null);
  protected readonly saving = signal(false);
  /** The row whose switch is mid-flight, so only that one goes inert. */
  protected readonly busyId = signal<string | null>(null);

  private readonly form = viewChild(SsoConnectionForm);

  protected readonly errorText = computed(() => errorMessage(this.settings.error()));

  protected readonly drawerHeading = computed(() => this.editingEntry()?.displayName ?? '');

  protected add(entry: SsoCatalogueEntry): void {
    this.editingConnection.set(null);
    this.editingEntry.set(entry);
    this.drawerOpen.set(true);
  }

  protected edit(connection: SsoConnection): void {
    const entry = this.loadedSettings()?.catalogue.find((c) => c.provider === connection.provider);
    if (!entry) return;
    this.editingConnection.set(connection);
    this.editingEntry.set(entry);
    this.drawerOpen.set(true);
  }

  /** Configured already — and not one of the kinds that may repeat. */
  protected isConfigured(entry: SsoCatalogueEntry, connections: SsoConnection[]): boolean {
    return !entry.repeatable && connections.some((c) => c.provider === entry.provider);
  }

  protected protocolHint(entry: SsoCatalogueEntry): string {
    return entry.protocol === 'saml' ? 'admin.sso.viaSaml' : 'admin.sso.viaOidc';
  }

  /** Standards' names, not UI copy — they read the same in every language. */
  protected protocolName(protocol: SsoConnection['protocol']): string {
    return { oidc: 'OIDC', saml: 'SAML 2.0', oauth2: 'OAuth 2.0' }[protocol];
  }

  protected statusTone(connection: SsoConnection): Tone {
    if (!connection.isEnabled) return 'neutral';
    return connection.status === 'active' ? 'success' : connection.status === 'error' ? 'danger' : 'warning';
  }

  protected statusLabel(connection: SsoConnection): string {
    if (!connection.isEnabled) return 'admin.sso.status.off';
    return `admin.sso.status.${connection.status}`;
  }

  /** Which sign-in pages this provider's button shows up on. */
  protected audienceLabel(connection: SsoConnection): string {
    if (connection.showOnStaffLogin && connection.showOnCustomerLogin) return 'admin.sso.audience.both';
    if (connection.showOnCustomerLogin) return 'admin.sso.audience.customers';
    if (connection.showOnStaffLogin) return 'admin.sso.audience.staff';
    return 'admin.sso.audience.hidden';
  }

  protected when(value: string): string {
    return formatDateTime(value);
  }

  protected async setEnabled(connection: SsoConnection, isEnabled: boolean): Promise<void> {
    this.busyId.set(connection.id);
    try {
      await this.api.setState(connection.id, { isEnabled });
      this.toast.success(this.transloco.translate('admin.sso.saved'));
    } catch (error) {
      // The server refuses to leave an installation with no way in; say so and
      // put the switch back where the server still has it.
      this.toast.error(errorMessage(error));
    } finally {
      this.settings.reload();
      this.busyId.set(null);
    }
  }

  protected async save(): Promise<void> {
    const form = this.form();
    if (!form) return;

    const invalid = form.validationError();
    if (invalid) {
      this.toast.error(invalid);
      return;
    }

    this.saving.set(true);
    try {
      const existing = this.editingConnection();
      if (existing) {
        await this.api.update(existing.id, form.body());
      } else {
        await this.api.create(form.body());
      }
      this.drawerOpen.set(false);
      this.settings.reload();
      this.toast.success(this.transloco.translate('admin.sso.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const existing = this.editingConnection();
    if (!existing) return;

    // Named, because on a list of providers the name is the only thing that
    // distinguishes the row somebody meant from the one they clicked.
    const confirmed = await this.confirm.ask({
      heading: this.transloco.translate('admin.sso.disconnectHeading'),
      message: this.transloco.translate('admin.sso.disconnectBody', { name: existing.providerName }),
      confirmLabel: this.transloco.translate('admin.sso.disconnect'),
      tone: 'danger',
    });
    if (!confirmed) return;

    this.saving.set(true);
    try {
      await this.api.remove(existing.id);
      this.drawerOpen.set(false);
      this.settings.reload();
      this.toast.success(this.transloco.translate('admin.sso.disconnected'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
