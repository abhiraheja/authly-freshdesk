import { ChangeDetectionStrategy, Component, computed, effect, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AdminApi, errorMessage, formatDateTime, type StorageProvider } from '@trackly/core';
import {
  Alert,
  Button,
  Card,
  Field,
  Icon,
  InputDirective,
  Radio,
  RadioGroup,
  SkeletonDirective,
  Spinner,
  ToastService,
} from '@trackly/ui';

/**
 * Admin → Storage: where this workspace's attachments live.
 *
 * **Credentials are write-only.** The server never returns them, so the form
 * can only report that one is stored and offer to replace it. A blank secret
 * box means "leave it alone", which is why saving does not wipe the key an
 * admin can no longer see.
 *
 * **Switching provider does not move anything.** Every stored key carries the
 * provider that wrote it, so old attachments keep being served from where they
 * are — but only while that provider's credentials remain. That is the one
 * thing on this page an admin can get badly wrong, so it is stated on the page
 * rather than buried in a doc.
 */
@Component({
  selector: 'tk-admin-storage-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslocoPipe,
    Alert,
    Button,
    Card,
    Field,
    Icon,
    InputDirective,
    Radio,
    RadioGroup,
    SkeletonDirective,
    Spinner,
  ],
  template: `
    <div class="mx-auto max-w-[760px]">
      <h1 class="font-display text-page font-extrabold">{{ 'admin.storage.title' | transloco }}</h1>
      <p class="mb-6 mt-1 text-body text-muted-foreground">{{ 'admin.storage.subtitle' | transloco }}</p>

      <!-- Value first, skeleton last: reloading after a save must not swap the
           form out from under whatever the admin is typing next. -->
      @if (config.value(); as saved) {
        <div class="space-y-4">
          <tk-card [heading]="'admin.storage.provider' | transloco">
            <tk-radio-group [(value)]="provider" [ariaLabel]="'admin.storage.provider' | transloco">
              <tk-radio
                value="local"
                [label]="'admin.storage.local' | transloco"
                [hint]="'admin.storage.localHint' | transloco"
              />
              <tk-radio
                value="azure"
                [label]="'admin.storage.azure' | transloco"
                [hint]="'admin.storage.azureHint' | transloco"
              />
              <tk-radio
                value="gcs"
                [label]="'admin.storage.gcs' | transloco"
                [hint]="'admin.storage.gcsHint' | transloco"
              />
            </tk-radio-group>
          </tk-card>

          @if (provider() === 'azure') {
            <tk-card [heading]="'admin.storage.azure' | transloco">
              <div class="space-y-4">
                <tk-field
                  [label]="'admin.storage.azureConnection' | transloco"
                  for="azure-connection"
                  [hint]="secretHint(saved.hasAzureConnectionString)"
                >
                  <input
                    tkInput
                    inset
                    id="azure-connection"
                    type="password"
                    autocomplete="off"
                    [placeholder]="secretPlaceholder(saved.hasAzureConnectionString)"
                    [(ngModel)]="azureConnectionString"
                  />
                </tk-field>

                <tk-field
                  [label]="'admin.storage.azureContainer' | transloco"
                  for="azure-container"
                  [hint]="'admin.storage.bucketHint' | transloco"
                >
                  <input tkInput inset id="azure-container" placeholder="trackly" [(ngModel)]="azureContainer" />
                </tk-field>
              </div>
            </tk-card>
          }

          @if (provider() === 'gcs') {
            <tk-card [heading]="'admin.storage.gcs' | transloco">
              <div class="space-y-4">
                <tk-field
                  [label]="'admin.storage.gcsKey' | transloco"
                  for="gcs-key"
                  [hint]="gcsKeyHint(saved.hasGcsCredentials)"
                  [error]="gcsKeyError()"
                >
                  <!-- A file picker AND a textarea: the key arrives as a
                       downloaded .json, but pasting it is quicker when it is
                       already on the clipboard from the GCP console. -->
                  <div class="mb-2 flex items-center gap-2">
                    <label tkButton variant="outline" size="sm" class="cursor-pointer">
                      <tk-icon name="upload-cloud" [size]="15" />
                      {{ 'admin.storage.gcsUpload' | transloco }}
                      <input type="file" accept="application/json,.json" class="sr-only" (change)="readKeyFile($event)" />
                    </label>
                    @if (gcsFileName()) {
                      <span class="min-w-0 truncate text-meta text-muted-foreground">{{ gcsFileName() }}</span>
                    }
                  </div>
                  <textarea
                    tkInput
                    inset
                    id="gcs-key"
                    rows="5"
                    spellcheck="false"
                    autocomplete="off"
                    [placeholder]="secretPlaceholder(saved.hasGcsCredentials)"
                    [(ngModel)]="gcsCredentialsJson"
                  ></textarea>
                </tk-field>

                <tk-field
                  [label]="'admin.storage.gcsBucket' | transloco"
                  for="gcs-bucket"
                  [hint]="'admin.storage.bucketHint' | transloco"
                >
                  <input tkInput inset id="gcs-bucket" placeholder="saarvix-beta-public" [(ngModel)]="gcsBucket" />
                </tk-field>
              </div>
            </tk-card>
          }

          <!-- One field for both cloud providers: the CDN fronts whichever
               bucket is configured. Meaningless for local disk, so it is not
               shown there. -->
          @if (provider() !== 'local') {
            <tk-card [heading]="'admin.storage.paths' | transloco">
              <tk-field
                [label]="'admin.storage.pathPrefix' | transloco"
                for="path-prefix"
                [hint]="'admin.storage.pathPrefixHint' | transloco"
              >
                <input tkInput inset id="path-prefix" placeholder="trackly" [(ngModel)]="pathPrefix" />
              </tk-field>
            </tk-card>

            <tk-card [heading]="'admin.storage.cdn' | transloco">
              <tk-field
                [label]="'admin.storage.cdnUrl' | transloco"
                for="cdn-url"
                [hint]="'admin.storage.cdnHint' | transloco"
              >
                <input tkInput inset id="cdn-url" placeholder="https://cdn-beta.saarvix.in" [(ngModel)]="publicBaseUrl" />
              </tk-field>

              <!-- The one thing nobody can work out from the field labels: what
                   a finished URL actually looks like. Built from what is typed,
                   so it updates as they go. -->
              <div class="mt-4 rounded-xl bg-muted p-3">
                <p class="mb-1.5 text-meta font-semibold">{{ 'admin.storage.previewHeading' | transloco }}</p>
                <code class="block break-all text-meta text-muted-foreground">{{ logoUrlPreview() }}</code>
              </div>

              <!-- Said on the page, not just in the docs: an admin who expects
                   this to speed up attachments needs to know it does not, and
                   why not. -->
              <p class="mt-3 flex gap-2 text-meta text-muted-foreground">
                <tk-icon name="lock" [size]="14" class="mt-0.5 shrink-0" />
                <span>{{ 'admin.storage.cdnScope' | transloco }}</span>
              </p>
            </tk-card>
          }

          <!-- Only worth saying once they are actually moving off a provider
               that already holds files. -->
          @if (provider() !== saved.provider && saved.provider !== 'local') {
            <tk-alert tone="warning" [heading]="'admin.storage.switchWarning' | transloco">
              {{ 'admin.storage.switchWarningBody' | transloco: { provider: providerName(saved.provider) } }}
            </tk-alert>
          }

          <tk-card flush>
            <div class="flex flex-wrap items-center gap-3 p-4">
              <button tkButton [disabled]="saving()" (click)="save()">
                @if (saving()) {
                  <tk-spinner [size]="16" />
                }
                {{ 'common.save' | transloco }}
              </button>

              <!-- Tests what is SAVED, not what is typed, so it is only offered
                   once there are no unsaved edits to mislead the result. -->
              <button tkButton variant="outline" [disabled]="testing() || dirty()" (click)="test()">
                @if (testing()) {
                  <tk-spinner [size]="16" />
                } @else {
                  <tk-icon name="shield-check" [size]="16" />
                }
                {{ 'admin.storage.test' | transloco }}
              </button>

              @if (dirty()) {
                <span class="text-meta text-muted-foreground">{{ 'admin.storage.saveFirst' | transloco }}</span>
              } @else if (saved.lastVerifiedAt) {
                <span class="inline-flex items-center gap-1.5 text-meta text-success">
                  <tk-icon name="check-circle" [size]="14" />
                  {{ 'admin.storage.verifiedAt' | transloco: { date: verifiedAt() } }}
                </span>
              }
            </div>
          </tk-card>

          @if (testResult(); as result) {
            <tk-alert
              [tone]="result.ok ? 'success' : 'danger'"
              [heading]="(result.ok ? 'admin.storage.testPassed' : 'admin.storage.testFailed') | transloco"
            >
              {{ result.ok ? ('admin.storage.testPassedBody' | transloco) : result.error }}
            </tk-alert>
          }
        </div>
      } @else if (config.error()) {
        <tk-alert tone="danger" [heading]="'admin.storage.loadFailed' | transloco">
          {{ errorText() }}
          <button type="button" class="ml-1 font-semibold underline" (click)="config.reload()">
            {{ 'common.retry' | transloco }}
          </button>
        </tk-alert>
      } @else {
        <div class="space-y-4">
          <span tkSkeleton class="h-40 w-full"></span>
          <span tkSkeleton class="h-24 w-full"></span>
        </div>
      }
    </div>
  `,
})
export class AdminStorageSettings {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly config = resource({ loader: () => this.api.storage() });

  protected readonly provider = signal<StorageProvider>('local');
  protected readonly azureContainer = signal('');
  protected readonly gcsBucket = signal('');
  protected readonly pathPrefix = signal('');
  protected readonly publicBaseUrl = signal('');

  /**
   * A worked example of the URL a logo will end up on, built from what is
   * typed. Nothing else on this page shows how the bucket, prefix and CDN
   * combine, and getting that wrong is silent — the logo just 404s.
   */
  protected readonly logoUrlPreview = computed(() => {
    const prefix = this.pathPrefix().trim().replace(/^\/+|\/+$/g, '');
    const path = [prefix, '<workspace-id>', 'branding', 'logo.png'].filter(Boolean).join('/');

    const cdn = this.publicBaseUrl().trim().replace(/\/+$/, '');
    // The CDN maps onto the bucket root, so the bucket name drops out of the
    // path — which is the bit that surprises people.
    if (cdn) return `${cdn}/${path}`;

    const bucket = this.provider() === 'gcs' ? this.gcsBucket().trim() : this.azureContainer().trim();
    if (!bucket) return this.transloco.translate('admin.storage.previewNeedsBucket');

    return this.provider() === 'gcs'
      ? `https://storage.googleapis.com/${bucket}/${path}`
      : `https://<account>.blob.core.windows.net/${bucket}/${path}`;
  });

  /** Blank means "keep what is stored" — never "clear it". */
  protected readonly azureConnectionString = signal('');
  protected readonly gcsCredentialsJson = signal('');
  protected readonly gcsFileName = signal('');

  protected readonly saving = signal(false);
  protected readonly testing = signal(false);
  protected readonly testResult = signal<{ ok: boolean; error?: string } | null>(null);

  protected readonly errorText = computed(() => errorMessage(this.config.error()));

  protected readonly verifiedAt = computed(() => {
    const at = this.config.value()?.lastVerifiedAt;
    return at ? formatDateTime(at) : '';
  });

  /**
   * Unsaved edits. Only used to gate the test button, which round-trips through
   * the SAVED settings — testing while the form says something else would
   * report a pass for credentials nobody is using.
   */
  protected readonly dirty = computed(() => {
    // Guarded rather than read straight: resource.value() throws while the
    // resource is in its error state, and this is read from the template.
    if (this.config.error()) return false;
    const saved = this.config.value();
    if (!saved) return false;
    return (
      this.provider() !== saved.provider ||
      this.azureContainer() !== (saved.azureContainer ?? '') ||
      this.gcsBucket() !== (saved.gcsBucket ?? '') ||
      this.pathPrefix() !== (saved.pathPrefix ?? '') ||
      this.publicBaseUrl() !== (saved.publicBaseUrl ?? '') ||
      this.azureConnectionString().length > 0 ||
      this.gcsCredentialsJson().length > 0
    );
  });

  /** Caught before the round trip so the message lands next to the field. */
  protected readonly gcsKeyError = computed(() => {
    const raw = this.gcsCredentialsJson().trim();
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed['private_key'] && parsed['client_email']) return undefined;
      return this.transloco.translate('admin.storage.gcsKeyShape');
    } catch {
      return this.transloco.translate('admin.storage.gcsKeyInvalid');
    }
  });

  constructor() {
    // Seeds the form from the server, and re-seeds after a save so the
    // "configured" hints and the dirty check are measured against fresh truth.
    effect(() => {
      const saved = this.config.value();
      if (!saved) return;
      this.provider.set(saved.provider);
      this.azureContainer.set(saved.azureContainer ?? '');
      this.gcsBucket.set(saved.gcsBucket ?? '');
      this.pathPrefix.set(saved.pathPrefix ?? '');
      this.publicBaseUrl.set(saved.publicBaseUrl ?? '');
      this.azureConnectionString.set('');
      this.gcsCredentialsJson.set('');
      this.gcsFileName.set('');
    });
  }

  protected providerName(provider: StorageProvider): string {
    return { local: 'Local disk', azure: 'Azure Blob Storage', gcs: 'Google Cloud Storage' }[provider];
  }

  /** "Configured — leave blank to keep it" vs "nothing stored yet". */
  protected secretHint(stored: boolean): string {
    return this.transloco.translate(stored ? 'admin.storage.storedHint' : 'admin.storage.notStoredHint');
  }

  protected secretPlaceholder(stored: boolean): string {
    return stored ? this.transloco.translate('admin.storage.keepPlaceholder') : '';
  }

  protected gcsKeyHint(stored: boolean): string {
    return this.secretHint(stored);
  }

  protected readKeyFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    void file.text().then((text) => {
      this.gcsCredentialsJson.set(text.trim());
      this.gcsFileName.set(file.name);
      // Clearing lets the same file be picked again after a failed save;
      // without it the change event never fires a second time.
      input.value = '';
    });
  }

  protected async save(): Promise<void> {
    if (this.gcsKeyError()) return;

    this.saving.set(true);
    this.testResult.set(null);
    try {
      await this.api.saveStorage({
        provider: this.provider(),
        azureContainer: this.azureContainer().trim(),
        gcsBucket: this.gcsBucket().trim(),
        pathPrefix: this.pathPrefix().trim(),
        publicBaseUrl: this.publicBaseUrl().trim(),
        // Undefined, not '': an empty box means keep the stored secret, and ''
        // is the wire value for "delete it".
        azureConnectionString: this.azureConnectionString().trim() || undefined,
        gcsCredentialsJson: this.gcsCredentialsJson().trim() || undefined,
      });
      this.config.reload();
      this.toast.success(this.transloco.translate('admin.storage.saved'));
    } catch (error) {
      this.toast.error(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async test(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    try {
      const result = await this.api.testStorage();
      this.testResult.set(result);
      if (result.ok) this.config.reload();
    } catch (error) {
      this.testResult.set({ ok: false, error: errorMessage(error) });
    } finally {
      this.testing.set(false);
    }
  }
}
