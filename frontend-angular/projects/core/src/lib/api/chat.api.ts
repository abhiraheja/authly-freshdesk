import { Injectable, inject } from '@angular/core';
import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr';
import { TRACKLY_CONFIG } from '../core.config';
import { ApiService } from './api.service';

/** Who wrote a line. `system` is Trackly's own ("You are through to support"). */
export type ChatSender = 'visitor' | 'agent' | 'system';

export interface ChatMessage {
  id: string;
  sessionId: string;
  sender: ChatSender;
  /** The agent's name. Null for the visitor and for system lines. */
  authorName: string | null;
  body: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  /** Null until an agent answers — which is what "new" means in the console. */
  agentId: string | null;
  agentName: string | null;
  /** Set once the chat ended and became a ticket. */
  ticketId: string | null;
  messageCount: number;
  createdAt: string;
}

export interface ChatThread {
  session: ChatSession;
  messages: ChatMessage[];
}

/** What a visitor gets back from `start`. The token is their only credential. */
export interface ChatStart {
  sessionId: string;
  token: string;
}

/**
 * Live chat.
 *
 * **REST is the source of truth; the hub is delivery.** Every message is posted
 * over HTTP and persisted before it is broadcast, so a dropped socket costs you
 * live updates and nothing else — reload and the conversation is all there. That
 * split is why the visitor page still works with WebSockets blocked, which is a
 * real condition on corporate networks rather than a hypothetical one.
 */
@Injectable({ providedIn: 'root' })
export class ChatApi {
  private readonly api = inject(ApiService);
  private readonly config = inject(TRACKLY_CONFIG);

  // ── Agent ─────────────────────────────────────────────────────────────────

  /** Every chat still waiting or in progress, oldest first. */
  sessions(): Promise<ChatSession[]> {
    return this.api.get<ChatSession[]>('/api/chat/sessions');
  }

  thread(sessionId: string): Promise<ChatThread> {
    return this.api.get<ChatThread>(`/api/chat/sessions/${sessionId}/messages`);
  }

  send(sessionId: string, body: string): Promise<ChatMessage> {
    return this.api.post<ChatMessage>(`/api/chat/sessions/${sessionId}/messages`, { body });
  }

  /** Ends the chat and turns the transcript into a ticket. */
  end(sessionId: string): Promise<{ ticketId: string }> {
    return this.api.post<{ ticketId: string }>(`/api/chat/sessions/${sessionId}/end`, {});
  }

  // ── Visitor ───────────────────────────────────────────────────────────────

  start(workspaceSlug: string, name?: string, email?: string): Promise<ChatStart> {
    return this.api.post<ChatStart>('/api/public/chat/start', { workspaceSlug, name, email });
  }

  visitorThread(sessionId: string, token: string): Promise<ChatThread> {
    return this.api.get<ChatThread>(`/api/public/chat/${sessionId}/messages`, { token });
  }

  visitorSend(sessionId: string, token: string, body: string): Promise<ChatMessage> {
    return this.api.post<ChatMessage>(`/api/public/chat/${sessionId}/messages?token=${encodeURIComponent(token)}`, {
      body,
    });
  }

  visitorEnd(sessionId: string, token: string): Promise<{ ticketId: string }> {
    return this.api.post<{ ticketId: string }>(
      `/api/public/chat/${sessionId}/end?token=${encodeURIComponent(token)}`,
      {},
    );
  }

  // ── Real-time ─────────────────────────────────────────────────────────────

  /**
   * A hub connection, not yet started.
   *
   * An **agent** connects with no query and is put in their workspace lobby by
   * the cookie the WebSocket handshake carries — that is how new chats appear
   * without polling. A **visitor** passes their session id and token, because
   * they have no cookie and the token is the whole of their identity.
   *
   * `withAutomaticReconnect` matters more here than in most places: a support
   * chat sits open on a laptop that gets closed and reopened, and reconnecting
   * silently is the difference between a conversation and a dead window.
   */
  connect(visitor?: { sessionId: string; token: string }): HubConnection {
    const query = visitor
      ? `?sessionId=${encodeURIComponent(visitor.sessionId)}&visitorToken=${encodeURIComponent(visitor.token)}`
      : '';

    return new HubConnectionBuilder()
      .withUrl(`${this.config.apiBaseUrl}${this.config.chatHubPath}${query}`)
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();
  }
}

export { HubConnectionState, type HubConnection };
