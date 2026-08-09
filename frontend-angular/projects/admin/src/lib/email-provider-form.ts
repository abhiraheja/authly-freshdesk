import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { inject } from '@angular/core';
import type { EmailProvider, EmailProviderBody } from '@trackly/core';
import { Alert, Button, Field, Icon, InputDirective, Switch } from '@trackly/ui';

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
        <!-- Said plainly rather than shown as a disabled Connect button: an
             admin who expects one-click linking needs to know it is an app
             password today, before they go looking for a button. -->
        <tk-alert tone="info" [heading]="'admin.email.form.appPasswordHeading' | transloco">
          {{ 'admin.email.form.appPasswordBody' | transloco: { name: p.displayName } }}
        </tk-alert>
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
      } @else {
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

  readonly provider = input.required<EmailProvider>();

  protected readonly accountEmail = signal('');
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
