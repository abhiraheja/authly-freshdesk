import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type {
  SsoCatalogueEntry,
  SsoConnection,
  SsoConnectionBody,
  SsoGroupMapping,
} from '@trackly/core';
import type { UserRole } from '@trackly/core';
import {
  Alert,
  Button,
  Field,
  Icon,
  InputDirective,
  Select,
  SelectOption,
  Switch,
  ToastService,
} from '@trackly/ui';

/**
 * The fields for one provider.
 *
 * **Which fields appear is the server's decision, not this file's.** The
 * catalogue entry says whether a provider needs a discovery URL, a tenant or a
 * secret, so adding a provider stays a one-entry change on the server instead of
 * a matching `if` here that someone will forget.
 *
 * The parent owns saving: it reads `body()` and `validationError()` off this
 * component so the actions can live in the drawer's footer, where a long form
 * cannot push them out of reach.
 */
@Component({
  selector: 'tk-sso-connection-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Button,
    Field,
    Icon,
    InputDirective,
    Select,
    SelectOption,
    Switch,
  ],
  template: `
    <div class="space-y-5">
      <tk-field [label]="'admin.sso.displayName' | transloco" for="sso-name" [hint]="'admin.sso.displayNameHint' | transloco">
        <input tkInput inset id="sso-name" [(ngModel)]="displayName" [placeholder]="entry().displayName" />
      </tk-field>

      @if (entry().protocol === 'saml') {
        <tk-field [label]="'admin.sso.metadataUrl' | transloco" for="sso-metadata-url" [hint]="'admin.sso.metadataUrlHint' | transloco">
          <input tkInput inset id="sso-metadata-url" placeholder="https://idp.example.com/app/metadata" [(ngModel)]="idpMetadataUrl" />
        </tk-field>

        <tk-field [label]="'admin.sso.metadataXml' | transloco" for="sso-metadata-xml" [hint]="'admin.sso.metadataXmlHint' | transloco">
          <textarea
            tkInput
            inset
            id="sso-metadata-xml"
            rows="4"
            spellcheck="false"
            class="font-mono text-meta"
            placeholder="&lt;EntityDescriptor …&gt;"
            [(ngModel)]="idpMetadataXml"
          ></textarea>
        </tk-field>

        <tk-field [label]="'admin.sso.spEntityId' | transloco" for="sso-sp-entity" [hint]="'admin.sso.spEntityIdHint' | transloco">
          <input tkInput inset id="sso-sp-entity" [(ngModel)]="spEntityId" />
        </tk-field>
      } @else {
        @if (entry().needsDiscoveryEndpoint) {
          <tk-field
            [label]="(baseUrlOnly() ? 'admin.sso.baseUrl' : 'admin.sso.discoveryEndpoint') | transloco"
            for="sso-discovery"
            [hint]="(baseUrlOnly() ? 'admin.sso.baseUrlHint' : 'admin.sso.discoveryEndpointHint') | transloco"
          >
            <input
              tkInput
              inset
              id="sso-discovery"
              [placeholder]="discoveryPlaceholder()"
              [(ngModel)]="discoveryEndpoint"
            />
            <!-- The URL Trackly will actually fetch. Nothing else on the form
                 shows it, and a base URL with a stray path is silent until a
                 sign-in fails on a 404 the admin never sees. -->
            @if (resolvedDiscovery(); as resolved) {
              <code class="mt-2 block break-all text-meta text-muted-foreground">{{ resolved }}</code>
            }
          </tk-field>
        }

        <!-- Two different questions wearing one column. Entra's tenant goes into
             the discovery URL; Authly's is a workspace slug sent with the sign-in
             request. Same field, so the label has to carry the difference. -->
        @if (entry().needsTenant) {
          <tk-field
            [label]="(entry().tenantIsSlug ? 'admin.sso.tenantSlug' : 'admin.sso.tenant') | transloco"
            for="sso-tenant"
            [hint]="(entry().tenantIsSlug ? 'admin.sso.tenantSlugHint' : 'admin.sso.tenantHint') | transloco"
          >
            <input tkInput inset id="sso-tenant" [placeholder]="entry().defaultTenant ?? ''" [(ngModel)]="tenant" />
          </tk-field>
        }

        <tk-field [label]="'admin.sso.clientId' | transloco" for="sso-client-id">
          <input tkInput inset id="sso-client-id" autocomplete="off" [(ngModel)]="clientId" />
        </tk-field>

        <tk-field [label]="'admin.sso.clientSecret' | transloco" for="sso-client-secret" [hint]="secretHint()">
          <input
            tkInput
            inset
            id="sso-client-secret"
            type="password"
            autocomplete="off"
            [placeholder]="secretPlaceholder()"
            [(ngModel)]="clientSecret"
          />
        </tk-field>

        @if (entry().needsDiscoveryEndpoint) {
          <tk-field [label]="'admin.sso.scopes' | transloco" for="sso-scopes" [hint]="'admin.sso.scopesHint' | transloco">
            <input tkInput inset id="sso-scopes" [placeholder]="entry().defaultScopes" [(ngModel)]="scopes" />
          </tk-field>
        }
      }

      <!-- The single most common setup failure is a redirect URI that does not
           match byte for byte, and it only shows up at the last step of a login.
           Built by the server from ApiBaseUrl, not from the browser's origin,
           which is wrong the moment the API is on another host. -->
      <div class="rounded-xl bg-muted p-3">
        <p class="mb-1.5 flex items-center justify-between gap-2 text-meta font-semibold">
          {{ (entry().protocol === 'saml' ? 'admin.sso.acsUrl' : 'admin.sso.redirectUri') | transloco }}
          <button tkButton variant="ghost" size="sm" (click)="copy(callbackUrl())">
            <tk-icon name="link" [size]="14" />
            {{ 'common.copy' | transloco }}
          </button>
        </p>
        <code class="block break-all text-meta text-muted-foreground">{{ callbackUrl() }}</code>
        <p class="mt-2 text-meta text-muted-foreground">
          {{ (entry().protocol === 'saml' ? 'admin.sso.acsUrlHint' : 'admin.sso.redirectUriHint') | transloco }}
        </p>
      </div>

      @if (connection()?.spMetadataUrl; as metadata) {
        <div class="rounded-xl bg-muted p-3">
          <p class="mb-1.5 flex items-center justify-between gap-2 text-meta font-semibold">
            {{ 'admin.sso.spMetadataUrl' | transloco }}
            <button tkButton variant="ghost" size="sm" (click)="copy(metadata)">
              <tk-icon name="link" [size]="14" />
              {{ 'common.copy' | transloco }}
            </button>
          </p>
          <code class="block break-all text-meta text-muted-foreground">{{ metadata }}</code>
        </div>
      }

      <!-- Where the button appears. Off for customers by default: an enterprise
           IdP knows staff, and a customer bounced off it has no way to tell why. -->
      <div class="divide-y divide-border rounded-xl border border-border">
        <label class="flex items-start justify-between gap-4 p-3">
          <span class="min-w-0">
            <span class="block font-semibold">{{ 'admin.sso.showOnStaff' | transloco }}</span>
            <span class="mt-0.5 block text-meta text-muted-foreground">{{ 'admin.sso.showOnStaffHint' | transloco }}</span>
          </span>
          <tk-switch [(checked)]="showOnStaffLogin" [ariaLabel]="'admin.sso.showOnStaff' | transloco" />
        </label>
        <label class="flex items-start justify-between gap-4 p-3">
          <span class="min-w-0">
            <span class="block font-semibold">{{ 'admin.sso.showOnCustomer' | transloco }}</span>
            <span class="mt-0.5 block text-meta text-muted-foreground">{{ 'admin.sso.showOnCustomerHint' | transloco }}</span>
          </span>
          <tk-switch [(checked)]="showOnCustomerLogin" [ariaLabel]="'admin.sso.showOnCustomer' | transloco" />
        </label>
      </div>

      <tk-field
        [label]="'admin.sso.allowedDomains' | transloco"
        for="sso-domains"
        [hint]="'admin.sso.allowedDomainsHint' | transloco"
      >
        <input tkInput inset id="sso-domains" placeholder="acme.com, acme.co.uk" [(ngModel)]="allowedEmailDomains" />
      </tk-field>

      @if (consumerProvider()) {
        <tk-alert tone="warning" [heading]="'admin.sso.openSignupHeading' | transloco">
          {{ 'admin.sso.openSignupBody' | transloco }}
        </tk-alert>
      }

      @if (entry().supportsGroups) {
        <div>
          <p class="font-semibold">{{ 'admin.sso.groupMapping' | transloco }}</p>
          <p class="mb-3 mt-0.5 text-meta text-muted-foreground">{{ 'admin.sso.groupMappingHint' | transloco }}</p>

          <div class="space-y-2">
            @for (mapping of mappings(); track $index) {
              <div class="flex items-center gap-2">
                <input
                  tkInput
                  inset
                  inputSize="sm"
                  [attr.aria-label]="'admin.sso.groupName' | transloco"
                  [placeholder]="'admin.sso.groupName' | transloco"
                  [ngModel]="mapping.groupName"
                  (ngModelChange)="setGroupName($index, $event)"
                />
                <tk-select
                  inset
                  size="sm"
                  auto
                  [value]="mapping.tracklyRole"
                  (valueChange)="setRole($index, $event)"
                  [ariaLabel]="'admin.sso.role' | transloco"
                >
                  <tk-option value="customer" [label]="'role.customer' | transloco" />
                  <tk-option value="agent" [label]="'role.agent' | transloco" />
                  <tk-option value="admin" [label]="'role.admin' | transloco" />
                </tk-select>
                <button
                  tkButton
                  variant="ghost"
                  iconOnly
                  [attr.aria-label]="'admin.sso.removeMapping' | transloco"
                  (click)="removeMapping($index)"
                >
                  <tk-icon name="trash-2" [size]="16" />
                </button>
              </div>
            }
          </div>

          <button tkButton variant="outline" size="sm" class="mt-2" (click)="addMapping()">
            <tk-icon name="plus" [size]="15" />
            {{ 'admin.sso.addMapping' | transloco }}
          </button>
        </div>
      }
    </div>
  `,
})
export class SsoConnectionForm {
  /** What this provider needs. Drives every conditional field above. */
  readonly entry = input.required<SsoCatalogueEntry>();
  /** Null when adding. */
  readonly connection = input<SsoConnection | null>(null);
  readonly redirectUri = input.required<string>();
  readonly samlAcsUrl = input.required<string>();

  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly displayName = signal('');
  protected readonly discoveryEndpoint = signal('');
  protected readonly clientId = signal('');
  /** Blank means "keep what is stored" — never "clear it". */
  protected readonly clientSecret = signal('');
  protected readonly tenant = signal('');
  protected readonly scopes = signal('');
  protected readonly allowedEmailDomains = signal('');
  protected readonly idpMetadataUrl = signal('');
  protected readonly idpMetadataXml = signal('');
  protected readonly spEntityId = signal('');
  protected readonly showOnStaffLogin = signal(true);
  protected readonly showOnCustomerLogin = signal(false);
  protected readonly mappings = signal<SsoGroupMapping[]>([]);

  protected readonly callbackUrl = computed(() =>
    this.entry().protocol === 'saml' ? this.samlAcsUrl() : this.redirectUri(),
  );

  /** The admin gives a base URL and Trackly appends the well-known path. */
  protected readonly baseUrlOnly = computed(() => this.entry().discoverySuffix !== null);

  /** A worked example, not copy — the shape of the answer is the whole hint. */
  protected readonly discoveryPlaceholder = computed(() =>
    this.baseUrlOnly() ? 'https://login.example.com' : 'https://idp.example.com/.well-known/openid-configuration',
  );

  /**
   * What will actually be fetched. Mirrors `SsoProviderCatalog` on the server,
   * including its tolerance for an admin who pasted the full discovery URL —
   * appending the suffix to that would 404, and a 404 here surfaces as a failed
   * sign-in rather than as a message on this form.
   */
  protected readonly resolvedDiscovery = computed(() => {
    const suffix = this.entry().discoverySuffix;
    const typed = this.discoveryEndpoint().trim().replace(/\/+$/, '');
    if (!suffix || !typed) return null;
    return typed.toLowerCase().endsWith(suffix.toLowerCase()) ? typed : typed + suffix;
  });

  /** Google and Facebook admit every account those companies have ever issued. */
  protected readonly consumerProvider = computed(
    () =>
      (this.entry().provider === 'google' || this.entry().provider === 'facebook') &&
      this.allowedEmailDomains().trim().length === 0,
  );

  constructor() {
    // Seeds from the connection being edited, and re-seeds after a save so the
    // "stored" hints are measured against fresh truth.
    effect(() => {
      const entry = this.entry();
      const saved = this.connection();
      this.displayName.set(saved?.providerName ?? entry.displayName);
      this.discoveryEndpoint.set(saved?.discoveryEndpoint ?? '');
      this.clientId.set(saved?.clientId ?? '');
      this.clientSecret.set('');
      this.tenant.set(saved?.tenant ?? '');
      this.scopes.set(saved?.scopes ?? '');
      this.allowedEmailDomains.set(saved?.allowedEmailDomains ?? '');
      this.idpMetadataUrl.set(saved?.idpMetadataUrl ?? '');
      this.idpMetadataXml.set(saved?.idpMetadataXml ?? '');
      this.spEntityId.set(saved?.spEntityId ?? '');
      this.showOnStaffLogin.set(saved?.showOnStaffLogin ?? true);
      this.showOnCustomerLogin.set(saved?.showOnCustomerLogin ?? false);
      this.mappings.set(saved ? saved.groupMappings.map((m) => ({ ...m })) : []);
    });
  }

  /**
   * Mirrors the server's rules so the message lands next to the form instead of
   * after a round trip. The server re-checks and refuses — this is not the control.
   */
  validationError(): string | null {
    const entry = this.entry();
    const t = (key: string) => this.transloco.translate(key);

    if (entry.protocol === 'saml') {
      return this.idpMetadataUrl().trim() || this.idpMetadataXml().trim() ? null : t('admin.sso.errors.metadata');
    }
    if (!this.clientId().trim()) return t('admin.sso.errors.clientId');
    if (entry.needsDiscoveryEndpoint && !this.discoveryEndpoint().trim()) return t('admin.sso.errors.discovery');
    if (entry.requiresClientSecret && !this.clientSecret() && !this.connection()?.hasClientSecret) {
      return t('admin.sso.errors.clientSecret');
    }
    return null;
  }

  body(): SsoConnectionBody {
    return {
      provider: this.entry().provider,
      providerName: this.displayName().trim() || this.entry().displayName,
      discoveryEndpoint: this.discoveryEndpoint().trim(),
      clientId: this.clientId().trim(),
      // Undefined, not '': an empty box keeps the stored secret, and '' is the
      // wire value for "delete it".
      clientSecret: this.clientSecret() || undefined,
      tenant: this.tenant().trim(),
      scopes: this.scopes().trim(),
      allowedEmailDomains: this.allowedEmailDomains().trim(),
      idpMetadataUrl: this.idpMetadataUrl().trim(),
      idpMetadataXml: this.idpMetadataXml().trim(),
      spEntityId: this.spEntityId().trim(),
      showOnStaffLogin: this.showOnStaffLogin(),
      showOnCustomerLogin: this.showOnCustomerLogin(),
      groupMappings: this.mappings().filter((m) => m.groupName.trim()),
    };
  }

  protected secretHint(): string {
    const key = this.connection()?.hasClientSecret
      ? 'admin.sso.secretStored'
      : this.entry().requiresClientSecret
        ? 'admin.sso.secretRequired'
        : 'admin.sso.secretOptional';
    return this.transloco.translate(key);
  }

  protected secretPlaceholder(): string {
    return this.connection()?.hasClientSecret ? this.transloco.translate('admin.sso.secretKeep') : '';
  }

  protected setGroupName(index: number, value: string): void {
    this.mappings.update((list) => list.map((m, i) => (i === index ? { ...m, groupName: value } : m)));
  }

  protected setRole(index: number, value: string): void {
    this.mappings.update((list) =>
      list.map((m, i) => (i === index ? { ...m, tracklyRole: value as UserRole } : m)),
    );
  }

  protected addMapping(): void {
    this.mappings.update((list) => [...list, { groupName: '', tracklyRole: 'agent' }]);
  }

  protected removeMapping(index: number): void {
    this.mappings.update((list) => list.filter((_, i) => i !== index));
  }

  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.toast.success(this.transloco.translate('common.copied'));
    } catch {
      // Clipboard access can be denied outright; the URL is on screen anyway.
      this.toast.error(this.transloco.translate('common.copyFailed'));
    }
  }
}
