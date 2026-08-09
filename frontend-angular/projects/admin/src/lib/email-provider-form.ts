import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { inject } from '@angular/core';
import type { EmailProvider, EmailProviderBody } from '@trackly/core';
import { Alert, Button, Field, Icon, InputDirective, Switch, ToastService } from '@trackly/ui';

/**
 * The credentials for one mail provider, inside the drawer.
 *
 * **Every provider asks for the same two things** — how to send and how to
 * receive — and differs only in what proves the account is yours. So the form is
 * one shape with the credential block swapped, rather than five forms that drift
 * apart.
 *
 * Secrets are write-only: the server returns `has*`, never the value, so a blank
 * box means "keep what is stored". That is why the placeholders say so out loud —
 * an empty password field that silently wipes a working password is the failure
 * this pattern exists to prevent.
 */
@Component({
  selector: 'tk-email-provider-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslocoPipe, Alert, Button, Field, Icon, InputDirective, Switch],
  template: `
    @let p = provider();

    <div class="space-y-5">
      @if (p.setupDocsUrl; as docs) {
        <a tkButton variant="outline" size="sm" target="_blank" rel="noopener" [href]="docs">
          <tk-icon name="external-link" [size]="15" />
          {{ 'admin.email.form.setupDocs' | transloco: { name: p.displayName } }}
        </a>
      }

      @if (p.authKind === 'oauth2') {
        @if (p.connected) {
          <!-- Named, not just "Connected": an admin with two Google accounts
               has no other way to tell which one consented. -->
          <tk-alert tone="success" [heading]="'admin.email.form.connectedHeading' | transloco">
            {{ 'admin.email.form.connectedBody' | transloco: { name: p.displayName, account: p.accountEmail ?? '' } }}
          </tk-alert>
        } @else {
          <div class="space-y-4">
            <tk-alert tone="info" [heading]="'admin.email.form.ownAppHeading' | transloco">
              {{ 'admin.email.form.ownAppBody' | transloco: { name: p.displayName } }}
            </tk-alert>

            <!-- Copied into the provider console before Connect will work at
                 all. Byte-identical or the provider rejects the handshake with
                 a message that never reaches Trackly. -->
            <div class="rounded-xl bg-muted p-3">
              <p class="mb-1.5 flex items-center justify-between gap-2 text-meta font-semibold">
                {{ 'admin.email.form.redirectUri' | transloco }}
                <button tkButton variant="ghost" size="sm" (click)="copy(redirectUri())">
                  <tk-icon name="link" [size]="14" />
                  {{ 'common.copy' | transloco }}
                </button>
              </p>
              <code class="block break-all text-meta text-muted-foreground">{{ redirectUri() }}</code>
              <p class="mt-2 text-meta text-muted-foreground">
                {{ 'admin.email.form.redirectUriHint' | transloco }}
              </p>
            </div>

            <tk-field [label]="'admin.email.form.clientId' | transloco" for="oauth-client-id">
              <input tkInput inset id="oauth-client-id" autocomplete="off" [(ngModel)]="oauthClientId" />
            </tk-field>

            <tk-field
              [label]="'admin.email.form.clientSecret' | transloco"
              for="oauth-client-secret"
              [hint]="secretHint(p.hasOauthClientSecret)"
            >
              <input
                tkInput
                inset
                id="oauth-client-secret"
                type="password"
                autocomplete="off"
                [placeholder]="secretPlaceholder(p.hasOauthClientSecret)"
                [(ngModel)]="oauthClientSecret"
              />
            </tk-field>

            <button tkButton [disabled]="connecting() || !canConnect()" (click)="connect.emit()">
              <tk-icon name="external-link" [size]="15" />
              {{ 'admin.email.form.connect' | transloco: { name: p.displayName } }}
            </button>

            <!-- The app password is not a lesser option: it is the only one for
                 a personal account that cannot publish an app internally, and
                 it keeps working. Said out loud so nobody registers a Cloud
                 project they did not need. -->
            <p class="border-t border-border pt-4 text-meta text-muted-foreground">
              {{ 'admin.email.form.appPasswordBody' | transloco: { name: p.displayName } }}
            </p>
          </div>
        }
      }

      <tk-field
        [label]="'admin.email.form.accountEmail' | transloco"
        for="provider-account"
        [hint]="'admin.email.form.accountEmailHint' | transloco"
      >
        <input tkInput inset id="provider-account" type="email" placeholder="support@acme.com" [(ngModel)]="accountEmail" />
      </tk-field>

      @if (p.authKind === 'access_key') {
        <!-- SES: a region and an IAM credential. The SMTP host is derived from
             the region, so asking for it as well would be asking twice. -->
        <div class="space-y-4">
          <tk-field
            [label]="'admin.email.form.sesRegion' | transloco"
            for="ses-region"
            [hint]="'admin.email.form.sesRegionHint' | transloco"
          >
            <input tkInput inset id="ses-region" placeholder="eu-west-1" [(ngModel)]="sesRegion" />
          </tk-field>

          <tk-field [label]="'admin.email.form.sesAccessKey' | transloco" for="ses-key">
            <input tkInput inset id="ses-key" autocomplete="off" [(ngModel)]="sesAccessKeyId" />
          </tk-field>

          <tk-field
            [label]="'admin.email.form.sesSecret' | transloco"
            for="ses-secret"
            [hint]="secretHint(p.hasSesSecretKey)"
          >
            <input
              tkInput
              inset
              id="ses-secret"
              type="password"
              autocomplete="off"
              [placeholder]="secretPlaceholder(p.hasSesSecretKey)"
              [(ngModel)]="sesSecretKey"
            />
          </tk-field>
        </div>
      } @else if (!p.connected) {
        <!-- Hidden once the account is connected, because they would be
             ignored: a token beats a stored password in ToSmtpAsync, so
             leaving the boxes on screen would invite an admin to fix a
             delivery problem by re-typing a password nothing reads. The
             values still round-trip on save — see body(). -->
        <div class="space-y-4">
          <p class="text-meta font-semibold uppercase tracking-wide text-muted-foreground">
            {{ 'admin.email.form.sending' | transloco }}
          </p>

          <tk-field [label]="'admin.email.form.smtpHost' | transloco" for="smtp-host" [hint]="hostHint(p)">
            <input tkInput inset id="smtp-host" [placeholder]="p.defaultSmtpHost ?? 'smtp.acme.com'" [(ngModel)]="smtpHost" />
          </tk-field>

          <div class="grid grid-cols-2 gap-3">
            <tk-field [label]="'admin.email.form.port' | transloco" for="smtp-port">
              <input
                tkInput
                inset
                id="smtp-port"
                type="number"
                inputmode="numeric"
                [placeholder]="p.defaultSmtpPort ?? 587"
                [(ngModel)]="smtpPort"
              />
            </tk-field>

            <tk-field [label]="'admin.email.form.username' | transloco" for="smtp-user">
              <input tkInput inset id="smtp-user" autocomplete="off" [(ngModel)]="smtpUsername" />
            </tk-field>
          </div>

          <tk-field
            [label]="'admin.email.form.password' | transloco"
            for="smtp-password"
            [hint]="secretHint(p.hasSmtpPassword)"
          >
            <input
              tkInput
              inset
              id="smtp-password"
              type="password"
              autocomplete="off"
              [placeholder]="secretPlaceholder(p.hasSmtpPassword)"
              [(ngModel)]="smtpPassword"
            />
          </tk-field>

          <label class="flex items-center justify-between gap-3">
            <span class="text-body">{{ 'admin.email.form.startTls' | transloco }}</span>
            <tk-switch [(checked)]="smtpUseStartTls" [ariaLabel]="'admin.email.form.startTls' | transloco" />
          </label>
        </div>

        @if (p.canReceive) {
          <div class="space-y-4 border-t border-border pt-5">
            <p class="text-meta font-semibold uppercase tracking-wide text-muted-foreground">
              {{ 'admin.email.form.receiving' | transloco }}
            </p>
            <p class="text-meta text-muted-foreground">{{ 'admin.email.form.receivingHint' | transloco }}</p>

            <tk-field [label]="'admin.email.form.imapHost' | transloco" for="imap-host">
              <input
                tkInput
                inset
                id="imap-host"
                [placeholder]="p.defaultImapHost ?? 'imap.acme.com'"
                [(ngModel)]="imapHost"
              />
            </tk-field>

            <div class="grid grid-cols-2 gap-3">
              <tk-field [label]="'admin.email.form.port' | transloco" for="imap-port">
                <input
                  tkInput
                  inset
                  id="imap-port"
                  type="number"
                  inputmode="numeric"
                  [placeholder]="p.defaultImapPort ?? 993"
                  [(ngModel)]="imapPort"
                />
              </tk-field>

              <tk-field [label]="'admin.email.form.username' | transloco" for="imap-user">
                <input tkInput inset id="imap-user" autocomplete="off" [(ngModel)]="imapUsername" />
              </tk-field>
            </div>

            <tk-field
              [label]="'admin.email.form.password' | transloco"
              for="imap-password"
              [hint]="secretHint(p.hasImapPassword)"
            >
              <input
                tkInput
                inset
                id="imap-password"
                type="password"
                autocomplete="off"
                [placeholder]="secretPlaceholder(p.hasImapPassword)"
                [(ngModel)]="imapPassword"
              />
            </tk-field>
          </div>
        }
      }

      @if (p.lastError; as failure) {
        <tk-alert tone="danger" [heading]="'admin.email.form.lastErrorHeading' | transloco">{{ failure }}</tk-alert>
      }
    </div>
  `,
})
export class EmailProviderForm {
  private readonly transloco = inject(TranslocoService);
  private readonly toast = inject(ToastService);

  readonly provider = input.required<EmailProvider>();

  /** Server-built, not `location.origin` — the API may be on another host. */
  readonly redirectUri = input.required<string>();

  /** Disables Connect while the page is saving and redirecting. */
  readonly connecting = input(false);

  /**
   * Save-then-redirect is the page's job, not the form's: the client id has to
   * reach the server before the handshake can start, and only the page knows
   * how to save.
   */
  readonly connect = output<void>();

  protected readonly accountEmail = signal('');
  protected readonly oauthClientId = signal('');
  protected readonly oauthClientSecret = signal('');
  protected readonly smtpHost = signal('');
  protected readonly smtpPort = signal<number | null>(null);
  protected readonly smtpUsername = signal('');
  protected readonly smtpPassword = signal('');
  protected readonly smtpUseStartTls = signal(true);
  protected readonly imapHost = signal('');
  protected readonly imapPort = signal<number | null>(null);
  protected readonly imapUsername = signal('');
  protected readonly imapPassword = signal('');
  protected readonly sesRegion = signal('');
  protected readonly sesAccessKeyId = signal('');
  protected readonly sesSecretKey = signal('');

  constructor() {
    // Re-seeds whenever the drawer is pointed at a different provider, so
    // opening Google after Yahoo never shows Yahoo's host.
    effect(() => {
      const p = this.provider();
      this.accountEmail.set(p.accountEmail ?? '');
      this.oauthClientId.set(p.oauthClientId ?? '');
      this.oauthClientSecret.set('');
      this.smtpHost.set(p.smtpHost ?? '');
      this.smtpPort.set(p.smtpPort);
      this.smtpUsername.set(p.smtpUsername ?? '');
      this.smtpUseStartTls.set(p.smtpUseStartTls);
      this.imapHost.set(p.imapHost ?? '');
      this.imapPort.set(p.imapPort);
      this.imapUsername.set(p.imapUsername ?? '');
      this.sesRegion.set(p.sesRegion ?? '');
      this.sesAccessKeyId.set(p.sesAccessKeyId ?? '');
      // Secrets always start blank — the server never sent them, and a blank
      // box is what tells it to keep what it has.
      this.smtpPassword.set('');
      this.imapPassword.set('');
      this.sesSecretKey.set('');
    });
  }

  /**
   * What the page will not let past. Returned as a message rather than a
   * boolean so the caller can say which field, and checked here because this is
   * where the values are.
   */
  readonly validationError = computed<string | null>(() => {
    const p = this.provider();
    const t = (key: string) => this.transloco.translate(key);

    if (p.authKind === 'access_key') {
      if (!this.sesRegion().trim()) return t('admin.email.form.errRegion');
      if (!this.sesAccessKeyId().trim()) return t('admin.email.form.errAccessKey');
      if (!this.sesSecretKey() && !p.hasSesSecretKey) return t('admin.email.form.errSecret');
      return null;
    }

    if (p.authKind === 'oauth2') {
      // Already linked: the token is the credential and there is nothing left
      // to require.
      if (p.connected) return null;

      // Two complete answers, and the admin picks one. Requiring the SMTP
      // fields as well would block the ordinary case — save the app
      // registration, then click Connect.
      if (this.hasAppRegistration()) {
        if (!this.oauthClientSecret() && !p.hasOauthClientSecret) return t('admin.email.form.errClientSecret');
        return null;
      }
      if (!this.hasStoredPassword()) return t('admin.email.form.errConnectOrPassword');
    }

    // The host may be left blank when the catalogue has one — that is the
    // point of pre-filling it.
    if (!this.smtpHost().trim() && !p.defaultSmtpHost) return t('admin.email.form.errHost');
    if (!this.smtpUsername().trim()) return t('admin.email.form.errUsername');
    if (!this.smtpPassword() && !p.hasSmtpPassword) return t('admin.email.form.errPassword');

    // Receiving is optional — but a half-filled mailbox is a mailbox that
    // silently never polls, so it is all or nothing.
    const mailbox = [this.imapUsername().trim(), this.imapPassword()].filter(Boolean).length;
    if (mailbox === 1 && !p.hasImapPassword) return t('admin.email.form.errMailbox');

    return null;
  });

  /** Omitted secrets keep the stored value; the page never sends `''` from here. */
  readonly body = computed<EmailProviderBody>(() => {
    const p = this.provider();

    if (p.authKind === 'access_key') {
      return {
        accountEmail: this.accountEmail().trim(),
        sesRegion: this.sesRegion().trim(),
        sesAccessKeyId: this.sesAccessKeyId().trim(),
        sesSecretKey: this.sesSecretKey() || undefined,
      };
    }

    return {
      accountEmail: this.accountEmail().trim(),
      // Always sent, including while the fields are hidden behind a live
      // connection: the server overwrites every non-secret field on save, so
      // omitting the client id would null it — and a connected provider with no
      // client id cannot refresh its token, which surfaces an hour later as mail
      // silently stopping. The signals mirror what the server sent, so this
      // round-trips rather than re-types.
      oauthClientId: this.oauthClientId().trim(),
      oauthClientSecret: this.oauthClientSecret() || undefined,
      smtpHost: this.smtpHost().trim(),
      smtpPort: this.smtpPort(),
      smtpUsername: this.smtpUsername().trim(),
      smtpPassword: this.smtpPassword() || undefined,
      smtpUseStartTls: this.smtpUseStartTls(),
      imapHost: this.imapHost().trim(),
      imapPort: this.imapPort(),
      imapUsername: this.imapUsername().trim(),
      imapPassword: this.imapPassword() || undefined,
    };
  });

  /** An app registration is on file or being typed right now. */
  private readonly hasAppRegistration = computed(
    () => this.oauthClientId().trim().length > 0 || !!this.provider().oauthClientId,
  );

  private readonly hasStoredPassword = computed(
    () => this.smtpPassword().length > 0 || this.provider().hasSmtpPassword,
  );

  /**
   * Connect needs the app registration to exist server-side by the time the
   * provider redirects back, and the page saves before it redirects — so a
   * secret typed but not yet saved counts.
   */
  protected readonly canConnect = computed(
    () => this.hasAppRegistration() && (this.oauthClientSecret().length > 0 || this.provider().hasOauthClientSecret),
  );

  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.toast.success(this.transloco.translate('common.copied'));
    } catch {
      // Clipboard access can be denied outright; the URI is on screen anyway.
      this.toast.error(this.transloco.translate('common.copyFailed'));
    }
  }

  protected secretHint(stored: boolean): string {
    return this.transloco.translate(stored ? 'admin.email.form.storedHint' : 'admin.email.form.notStoredHint');
  }

  protected secretPlaceholder(stored: boolean): string {
    return stored ? this.transloco.translate('admin.email.form.keepPlaceholder') : '';
  }

  protected hostHint(p: EmailProvider): string {
    return p.defaultSmtpHost
      ? this.transloco.translate('admin.email.form.hostKnownHint', { host: p.defaultSmtpHost })
      : this.transloco.translate('admin.email.form.hostHint');
  }
}
