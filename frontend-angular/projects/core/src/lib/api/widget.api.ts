import { Injectable, inject } from '@angular/core';
import { HubConnectionBuilder, LogLevel, type HubConnection } from '@microsoft/signalr';
import { ApiService } from './api.service';
import { TRACKLY_CONFIG } from '../core.config';

// ---- Wire types ------------------------------------------------------------
// These mirror the DTOs in src/Trackly.Modules/Widgets. Keep them in step.

export interface WidgetPublicConfig {
  token: string;
  name: string;
  tagline: string | null;
  greeting: string | null;
  /** Where the panel document lives. The loader's iframe src; unused in here. */
  frameUrl: string;
  workspaceName: string;
  primaryColor: string;
  logoUrl: string | null;
  hidePoweredBy: boolean;
  hideLauncher: boolean;
  launchWidget: boolean;
  showWidgetForm: boolean;
  showCloseButton: boolean;
  showSendButton: boolean;
  identityVerificationEnabled: boolean;
  requireEmailVerification: boolean;
}

export interface WidgetIdentity {
  unique_id?: string | null;
  name?: string | null;
  mail?: string | null;
  number?: string | null;
  token?: string | null;
  variables?: Record<string, string> | null;
}

export interface WidgetSession {
  /** Present only on the response that mints it. Stored, then sent as a header. */
  visitorToken: string | null;
  visitorId: string;
  isVerified: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  showDetailsForm: boolean;
  /** Why a host page's identity payload was refused, if one was. */
  identityError: string | null;
}

export interface WidgetConversation {
  id: string;
  reference: string;
  subject: string;
  status: string;
  statusCategory: string;
  lastSenderName: string | null;
  lastFromAgent: boolean;
  preview: string;
  unreadCount: number;
  createdAt: string;
  lastMessageAt: string;
}

export interface WidgetAttachment {
  id: string;
  commentId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface WidgetMessage {
  id: string;
  fromAgent: boolean;
  authorName: string | null;
  body: string;
  bodyFormat: 'text' | 'html';
  attachments: WidgetAttachment[];
  createdAt: string;
}

export interface WidgetThread {
  id: string;
  reference: string;
  subject: string;
  status: string;
  statusCategory: string;
  agentName: string | null;
  messages: WidgetMessage[];
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetConversationCreated {
  id: string;
  reference: string;
  subject: string;
  status: string;
  createdAt: string;
}

/**
 * The embedded panel's API — anonymous, addressed by the widget's public token.
 *
 * No method takes a workspace: the server resolves it from the token
 * (invariant 1). What a caller may read is decided server-side by the trust rule
 * (docs/widget-plan.md § 3.3), so nothing here filters anything.
 */
@Injectable({ providedIn: 'root' })
export class WidgetApi {
  private readonly api = inject(ApiService);
  // `runtime`, not `config` — `config()` below is an endpoint on this class.
  private readonly runtime = inject(TRACKLY_CONFIG);

  private base(widgetToken: string): string {
    return `/api/public/widget/${encodeURIComponent(widgetToken)}`;
  }

  config(widgetToken: string): Promise<WidgetPublicConfig> {
    return this.api.get<WidgetPublicConfig>(`${this.base(widgetToken)}/config`);
  }

  startSession(widgetToken: string, identity?: WidgetIdentity): Promise<WidgetSession> {
    return this.api.post<WidgetSession>(`${this.base(widgetToken)}/session`, identity ?? {});
  }

  updateSession(widgetToken: string, identity: WidgetIdentity): Promise<WidgetSession> {
    return this.api.patch<WidgetSession>(`${this.base(widgetToken)}/session`, identity);
  }

  sendEmailCode(widgetToken: string, email: string): Promise<void> {
    return this.api.post<void>(`${this.base(widgetToken)}/session/verify-email`, { email });
  }

  confirmEmailCode(widgetToken: string, email: string, code: string): Promise<WidgetSession> {
    return this.api.post<WidgetSession>(`${this.base(widgetToken)}/session/verify-email/confirm`, {
      email,
      code,
    });
  }

  conversations(widgetToken: string): Promise<WidgetConversation[]> {
    return this.api.get<WidgetConversation[]>(`${this.base(widgetToken)}/conversations`);
  }

  thread(widgetToken: string, conversationId: string): Promise<WidgetThread> {
    return this.api.get<WidgetThread>(`${this.base(widgetToken)}/conversations/${conversationId}`);
  }

  createConversation(
    widgetToken: string,
    body: { message: string; subject?: string; categoryId?: string },
  ): Promise<WidgetConversationCreated> {
    return this.api.post<WidgetConversationCreated>(`${this.base(widgetToken)}/conversations`, body);
  }

  reply(widgetToken: string, conversationId: string, message: string): Promise<WidgetMessage> {
    return this.api.post<WidgetMessage>(
      `${this.base(widgetToken)}/conversations/${conversationId}/messages`,
      { message },
    );
  }

  /** Stamps the read marker. Fire-and-forget from the caller's point of view. */
  markRead(widgetToken: string, conversationId: string): Promise<void> {
    return this.api.post<void>(
      `${this.base(widgetToken)}/conversations/${conversationId}/read`,
      {},
    );
  }

  uploadAttachment(
    widgetToken: string,
    conversationId: string,
    file: File,
    messageId?: string,
  ): Promise<WidgetAttachment> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.api.upload<WidgetAttachment>(
      `${this.base(widgetToken)}/conversations/${conversationId}/attachments`,
      form,
      { params: { messageId } },
    );
  }

  /** A direct browser URL — the visitor token rides on the interceptor, so this
   * is only usable from a same-origin fetch, not from an `<a download>`. */
  attachmentUrl(widgetToken: string, conversationId: string, attachmentId: string): string {
    return this.api.url(
      `${this.base(widgetToken)}/conversations/${conversationId}/attachments/${attachmentId}`,
    );
  }

  // ── Real-time ───────────────────────────────────────────────────────────────

  /**
   * A hub connection, not yet started.
   *
   * Both credentials travel in the query string because that is what
   * `WidgetHub.OnConnectedAsync` reads, and because a WebSocket handshake cannot
   * carry the `X-Trackly-Visitor` header the REST calls use — there is no way to
   * set a request header on `new WebSocket()`.
   *
   * Same-origin despite the widget being an embed: the panel document is served
   * by Trackly and only *displayed* in the host page's iframe, so the socket
   * never crosses an origin and the widget CORS policy is not involved.
   *
   * `withAutomaticReconnect` is the whole point of preferring this to a poll — a
   * widget sits open on a laptop lid that closes, and a socket that gave up on
   * the first drop would be worse than the interval it replaced.
   */
  connect(widgetToken: string, visitorToken: string): HubConnection {
    const query =
      `?widget=${encodeURIComponent(widgetToken)}` +
      `&visitorToken=${encodeURIComponent(visitorToken)}`;

    return new HubConnectionBuilder()
      .withUrl(`${this.runtime.apiBaseUrl}${this.runtime.widgetHubPath}${query}`)
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();
  }
}
