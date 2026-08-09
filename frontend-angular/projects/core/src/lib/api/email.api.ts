import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

/**
 * The provider *kind*. Selects the brand mark, which fields the form asks for,
 * and which endpoints the server talks to — not a label, which is the server's
 * `displayName`.
 *
 * A string union rather than `string`, for the same reason as
 * {@link SsoProviderKind}: every per-provider branch in the UI has to be
 * exhaustive and the compiler is what makes it so.
 */
export type EmailProviderKind = 'google' | 'microsoft' | 'yahoo' | 'smtp' | 'ses';

/**
 * How the admin proves the account is theirs.
 *
 * - `oauth2` — they click Connect and sign in at the provider. No password is
 *   ever typed into Trackly.
 * - `password` — host, username and an app password. The escape hatch that works
 *   against anything with an SMTP port.
 * - `access_key` — an id and a secret key issued by the provider (SES).
 */
export type EmailAuthKind = 'oauth2' | 'password' | 'access_key';

/**
 * One card in the grid — the catalogue entry merged with whatever has been
 * configured for it. Providers with no row still appear, showing "not
 * connected"; a missing card would leave an admin hunting for a provider Trackly
 * supports perfectly well.
 *
 * Secrets are never returned. `has*` says one is stored (invariant 3).
 */
export interface EmailProvider {
  readonly provider: EmailProviderKind;
  readonly displayName: string;
  readonly authKind: EmailAuthKind;
  readonly canSend: boolean;
  readonly canReceive: boolean;
  /** The provider itself charges for this — a fact about them, not about Trackly. */
  readonly paid: boolean;
  /** Where the admin registers the app or issues the credential. */
  readonly setupDocsUrl: string | null;
  /**
   * The handshake is directory-scoped, so the form asks for one. Microsoft only:
   * Entra rejects the shared `/common` endpoint for a single-tenant app
   * registration, which is what an operator registering for their own company
   * gets by default.
   */
  readonly requiresTenant: boolean;

  /** Shown as placeholders so an admin can see what Trackly will use unasked. */
  readonly defaultSmtpHost: string | null;
  readonly defaultSmtpPort: number | null;
  readonly defaultImapHost: string | null;
  readonly defaultImapPort: number | null;

  /** A row exists — the admin has saved something, enabled or not. */
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly accountEmail: string | null;

  readonly oauthClientId: string | null;
  /** Blank means `common`. Not a secret — it is in every sign-in URL. */
  readonly oauthTenantId: string | null;
  readonly hasOauthClientSecret: boolean;
  /** OAuth tokens are stored — the account is actually linked, not merely registered. */
  readonly connected: boolean;

  readonly smtpHost: string | null;
  readonly smtpPort: number | null;
  readonly smtpUsername: string | null;
  readonly hasSmtpPassword: boolean;
  readonly smtpUseStartTls: boolean;

  readonly imapHost: string | null;
  readonly imapPort: number | null;
  readonly imapUsername: string | null;
  readonly hasImapPassword: boolean;

  readonly sesRegion: string | null;
  readonly sesAccessKeyId: string | null;
  readonly hasSesSecretKey: boolean;

  /** This provider's credentials last worked. Per-provider health, not proof of delivery. */
  readonly lastVerifiedAt: string | null;
  readonly lastError: string | null;
}

export interface EmailProvidersResponse {
  readonly providers: EmailProvider[];
  /** Null means outbound mail goes through the deployment's own relay. */
  readonly sendingProvider: EmailProviderKind | null;
  /** Null means inbound arrives by webhook, or not at all. */
  readonly receivingProvider: EmailProviderKind | null;
  /**
   * A test message was actually **delivered** — the installation-wide proof
   * invariant 8 counts before password sign-in may be switched off. Distinct
   * from a provider's own `lastVerifiedAt`, which only says its credentials
   * authenticate. Every provider change clears this.
   */
  readonly lastVerifiedAt: string | null;

  /**
   * The exact URI the provider must redirect back to, echoed by the server.
   *
   * Shown so the admin can copy it into their own Google or Entra console. It has
   * to match byte for byte — a trailing slash is a failure at the provider with a
   * message that never reaches Trackly, and it is the most common way this setup
   * goes wrong.
   */
  readonly oauthRedirectUri: string;
}

/**
 * A save. Every secret follows Trackly's three-way rule: **omitted keeps what is
 * stored, `''` clears it, anything else replaces it** — which is what lets a form
 * round-trip a password it was never allowed to read back.
 */
export interface EmailProviderBody {
  enabled?: boolean;
  accountEmail?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthTenantId?: string;
  smtpHost?: string;
  smtpPort?: number | null;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpUseStartTls?: boolean;
  imapHost?: string;
  imapPort?: number | null;
  imapUsername?: string;
  imapPassword?: string;
  sesRegion?: string;
  sesAccessKeyId?: string;
  sesSecretKey?: string;
}

/** Connecting and authenticating only — nothing is sent and no mail is consumed. */
export interface EmailProviderTestResult {
  readonly ok: boolean;
  readonly verifiedAt?: string;
  readonly error?: string;
}

/** Notifications only, one-way (customers reply), two-way (both sides reply). */
export type EmailMode = 'notifications_only' | 'one_way' | 'two_way';

/** How inbound mail reaches Trackly. Null means it doesn't. */
export type InboundConnector = 'parse_webhook' | 'mailbox_poll';

export type InboundProvider = 'sendgrid' | 'mailgun' | 'postmark' | 'ses';

/**
 * The settings that are about the *installation* rather than one provider:
 * identity on outgoing mail, whether replies come back, and the webhook route.
 *
 * Credentials are never here — those are provider rows. The SMTP and mailbox
 * columns that used to ride along were dropped server-side by the
 * `EmailProviderCleanup` migration, along with the `/api/admin/settings/email`
 * endpoint that wrote them.
 */
export interface EmailConfig {
  readonly fromName: string | null;
  readonly fromEmail: string | null;
  readonly emailMode: EmailMode;
  /** A cold email with no matching ticket opens a new one. */
  readonly newTicketViaEmail: boolean;
  readonly inboundConnector: InboundConnector | null;
  readonly inboundProvider: InboundProvider | null;
  readonly inboundReplyDomain: string | null;
  readonly hasInboundWebhookSecret: boolean;
  readonly pollIntervalSeconds: number;
  readonly lastPolledAt: string | null;
  readonly lastVerifiedAt: string | null;
}

export interface EmailConfigBody {
  fromName?: string | null;
  fromEmail?: string | null;
  emailMode: EmailMode;
  newTicketViaEmail: boolean;
  inboundConnector?: InboundConnector | null;
  inboundProvider?: InboundProvider | null;
  inboundReplyDomain?: string | null;
  inboundWebhookSecret?: string | null;
  pollIntervalSeconds?: number;
}

/**
 * Where the subject and body came from.
 *
 * `built-in` means **no row exists** — the catalogue in the server's code is
 * what renders. It is not a copy of a default sitting in the database waiting to
 * go stale, which is why Reset is a delete and why an improved default in a later
 * release reaches an install that never customised it.
 */
export type EmailTemplateSource = 'built-in' | 'custom';

/** One row in the template list. */
export interface EmailTemplateSummary {
  readonly key: string;
  /** English, from the server's catalogue — not a translation key. */
  readonly name: string;
  readonly description: string;
  /**
   * The shared frame every other template renders into, rather than a message
   * anyone receives. It has no subject and cannot be sent on its own.
   */
  readonly isLayout: boolean;
  readonly locale: string;
  readonly source: EmailTemplateSource;
  readonly subject: string;
  /**
   * A customisation that is switched on. `false` falls back to the built-in —
   * it never stops the email being sent, because a toggle that silently killed
   * sign-in codes would be an invariant 8 lockout wearing a friendly label.
   */
  readonly isActive: boolean;
  /** Skip the shared layout — for a finished HTML email from a designer. */
  readonly standalone: boolean;
  readonly updatedAt: string | null;
}

export interface EmailTemplateDetail extends EmailTemplateSummary {
  readonly bodyHtml: string;
  /** What this template may use, on top of {@link globalVariables}. */
  readonly variables: readonly string[];
  /** Branding and workspace values every template can use. */
  readonly globalVariables: readonly string[];
  /** What it cannot be saved without — see {@link EmailApi.saveTemplate}. */
  readonly required: readonly string[];
  readonly builtInSubject: string;
  readonly builtInBodyHtml: string;
}

/**
 * A draft. `subject` and `bodyHtml` omitted together means "whatever is stored"
 * — which is how the list previews and tests a template it has not opened.
 */
export interface EmailTemplateDraft {
  subject?: string | null;
  bodyHtml?: string | null;
  standalone?: boolean;
}

export interface EmailTemplateBody extends EmailTemplateDraft {
  isActive?: boolean;
}

/**
 * A render of sample data. `error` instead of the other three when the template
 * cannot render — a preview of a broken template is how the broken part is
 * found, so it is reported rather than thrown.
 */
export interface EmailTemplatePreview {
  readonly subject?: string;
  readonly html?: string;
  readonly text?: string;
  readonly error?: string;
}

/**
 * Proves this one template reaches a person. Deliberately does **not** count as
 * the installation's delivery proof — that stays on {@link AdminApi.testEmail},
 * the one endpoint whose whole purpose is to establish it.
 */
export interface EmailTemplateTestResult {
  readonly ok: boolean;
  readonly sentTo?: string;
  readonly error?: string;
}

export interface NotificationSettings {
  notifyCustomerOnCreate: boolean;
  notifyCustomerOnReply: boolean;
  notifyCustomerOnStatus: boolean;
  notifyAgentOnAssign: boolean;
  notifyAgentOnReply: boolean;
  notifyAgentOnReassign: boolean;
  csatEnabled: boolean;
}

/**
 * Admin → Email.
 *
 * Providers are rows, so every call names one by kind. Which provider sends and
 * which receives is workspace policy rather than a property of a credential, so
 * it is set through {@link setRoles} on the config — several can be connected at
 * once while exactly one sends.
 */
@Injectable({ providedIn: 'root' })
export class EmailApi {
  private readonly api = inject(ApiService);

  providers(): Promise<EmailProvidersResponse> {
    return this.api.get<EmailProvidersResponse>('/api/admin/email/providers');
  }

  saveProvider(provider: EmailProviderKind, body: EmailProviderBody): Promise<EmailProvider> {
    return this.api.put<EmailProvider>(`/api/admin/email/providers/${provider}`, body);
  }

  /**
   * Begins the OAuth handshake and returns where to send the browser.
   *
   * The caller navigates the whole page there — never a popup. Popups get
   * blocked, need `postMessage` plumbing to report back, and fail outright in an
   * embedded browser view, all to save one page load.
   */
  connect(provider: EmailProviderKind): Promise<{ authorizeUrl: string }> {
    return this.api.post<{ authorizeUrl: string }>(`/api/admin/email/providers/${provider}/connect`, {});
  }

  /**
   * Redeems what the provider handed back to `/oauth/callback`.
   *
   * The provider redirects to a **front-end** route, so this leg is an ordinary
   * same-origin request carrying the admin's session — which is why the server
   * can require one. The `state` is still what proves the handshake is genuine;
   * it is single-use, so calling this twice with the same code fails by design.
   */
  completeConnect(state: string, code: string): Promise<{ provider: EmailProviderKind }> {
    return this.api.post<{ provider: EmailProviderKind }>('/api/admin/email/oauth/complete', { state, code });
  }

  /** Forgets the credentials and the row — a disconnected provider stores nothing. */
  disconnect(provider: EmailProviderKind): Promise<void> {
    return this.api.delete<void>(`/api/admin/email/providers/${provider}`);
  }

  /**
   * Proves one provider's credentials authenticate.
   *
   * Deliberately not the same thing as {@link testEmail}: this connects and
   * stops. Only a delivered message satisfies invariant 8, because a provider
   * authenticating says nothing about whether mail arrives.
   */
  testProvider(provider: EmailProviderKind): Promise<EmailProviderTestResult> {
    return this.api.post<EmailProviderTestResult>(`/api/admin/email/providers/${provider}/test`, {});
  }

  /** Null for either clears it; a null sender falls back to the deployment relay. */
  setRoles(body: {
    sendingProvider: EmailProviderKind | null;
    receivingProvider: EmailProviderKind | null;
  }): Promise<{ lastVerifiedAt: string | null }> {
    return this.api.put<{ lastVerifiedAt: string | null }>('/api/admin/email/roles', body);
  }

  config(): Promise<EmailConfig> {
    return this.api.get<EmailConfig>('/api/admin/email/config');
  }

  /**
   * Not `/api/admin/settings/email` — that endpoint still writes the deprecated
   * SMTP and mailbox columns, so saving a From name through it would clear the
   * credentials a rollback would land on.
   */
  saveConfig(body: EmailConfigBody): Promise<EmailConfig> {
    return this.api.put<EmailConfig>('/api/admin/email/config', body);
  }

  // ---- Templates -----------------------------------------------------------

  /** The whole catalogue, customised or not — a key with no row still appears. */
  templates(): Promise<EmailTemplateSummary[]> {
    return this.api.get<EmailTemplateSummary[]>('/api/admin/email/templates');
  }

  /**
   * One template, with the built-in alongside whatever replaced it.
   *
   * Both are sent so the editor can offer Reset without a round trip, and so an
   * admin can see what they are resetting *to* before they commit to it.
   */
  template(key: string): Promise<EmailTemplateDetail> {
    return this.api.get<EmailTemplateDetail>(`/api/admin/email/templates/${encodeURIComponent(key)}`);
  }

  /**
   * Upsert. The server sanitises the body and refuses a template that has lost a
   * required variable — deleting `{{action_url}}` while rewording the sign-in
   * email would lock every user out of a product with no support desk.
   */
  saveTemplate(key: string, body: EmailTemplateBody): Promise<{ key: string; source: EmailTemplateSource; updatedAt: string }> {
    return this.api.put<{ key: string; source: EmailTemplateSource; updatedAt: string }>(
      `/api/admin/email/templates/${encodeURIComponent(key)}`,
      body,
    );
  }

  /** Back to built-in — deleting the customisation, not blanking it. */
  resetTemplate(key: string): Promise<{ key: string; source: EmailTemplateSource }> {
    return this.api.delete<{ key: string; source: EmailTemplateSource }>(
      `/api/admin/email/templates/${encodeURIComponent(key)}`,
    );
  }

  /**
   * Renders a draft with sample data. Nothing is written and nothing is sent.
   *
   * Server-side because the renderer is server-side: a JavaScript reimplementation
   * would be a second engine, and it would start disagreeing with the first
   * exactly when it mattered — as somebody was about to save.
   */
  previewTemplate(key: string, draft: EmailTemplateDraft = {}): Promise<EmailTemplatePreview> {
    return this.api.post<EmailTemplatePreview>(`/api/admin/email/templates/${encodeURIComponent(key)}/preview`, draft);
  }

  /** Sends this one template, with sample data. Blank `to` means the signed-in admin. */
  testTemplate(key: string, body: EmailTemplateDraft & { to?: string }): Promise<EmailTemplateTestResult> {
    return this.api.post<EmailTemplateTestResult>(`/api/admin/email/templates/${encodeURIComponent(key)}/test`, body);
  }

  notificationSettings(): Promise<NotificationSettings> {
    return this.api.get<NotificationSettings>('/api/admin/settings/notifications');
  }

  saveNotificationSettings(body: NotificationSettings): Promise<NotificationSettings> {
    return this.api.put<NotificationSettings>('/api/admin/settings/notifications', body);
  }
}
