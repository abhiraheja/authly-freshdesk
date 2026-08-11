import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr';
import { TRACKLY_CONFIG } from '../core.config';

/** One push from the desk hub: which ticket moved, and when we heard about it. */
export interface TicketChange {
  ticketId: string;
  /**
   * Bumped on every push, including repeats for the same ticket. Without it a
   * second reply to the ticket already on screen would produce an identical
   * object and no effect would re-run — the agent would see the first reply and
   * silently miss the rest.
   */
  seq: number;
}

/**
 * "Something happened to a ticket in this workspace."
 *
 * <h3>Why a shared store and not a `connect()` per screen</h3>
 * The other hubs in this app hand each consumer its own connection because each
 * one watches a different thing — a chat session, a release. This one is
 * workspace-wide and every agent screen wants the same feed, so a connection per
 * component would open several sockets to the same group and reconnect them on
 * every navigation. One socket, one signal, any number of readers.
 *
 * <h3>What arrives is an id, never content</h3>
 * The server sends `ticket` with a `{ ticketId }`. Screens re-fetch through the
 * ticket endpoints, which is where workspace isolation and the private-note
 * rules already live (invariants 1 and 5) — a socket that carried comment bodies
 * would be a second place those have to be right.
 *
 * <h3>Staff only</h3>
 * The hub refuses to put a customer in the group, so this is safe to start from
 * any agent screen. It is deliberately **not** started from the portal or guest
 * surfaces: those show one person's ticket, and a workspace-wide feed is not
 * theirs to hold open.
 */
@Injectable({ providedIn: 'root' })
export class TicketRealtime {
  private readonly runtime = inject(TRACKLY_CONFIG);

  private connection: HubConnection | null = null;
  private starting: Promise<void> | null = null;
  private seq = 0;

  private readonly _lastChange = signal<TicketChange | null>(null);
  /** The most recent push. Read it from an `effect` and compare the ticket id. */
  readonly lastChange = this._lastChange.asReadonly();

  private readonly _live = signal(false);
  /**
   * Whether the socket is currently up. Screens fall back to their own polling
   * when it is not — a corporate proxy that blocks WebSockets is a real
   * condition, and "no live updates" must not become "no updates".
   */
  readonly live = this._live.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => void this.connection?.stop());
  }

  /**
   * Opens the socket if it is not already open. Idempotent and safe to call from
   * every agent screen's constructor — concurrent callers await the same start.
   *
   * Never rejects. A hub that cannot be reached (blocked WebSockets, a 401 on an
   * expired session, no hub mapped at all) leaves {@link live} false and costs
   * live updates, nothing else.
   */
  ensureStarted(): void {
    if (this.connection?.state === HubConnectionState.Connected || this.starting) return;

    const connection = new HubConnectionBuilder()
      .withUrl(`${this.runtime.apiBaseUrl}${this.runtime.ticketHubPath}`)
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on('ticket', (payload: { ticketId?: string }) => {
      if (!payload?.ticketId) return;
      this._lastChange.set({ ticketId: payload.ticketId, seq: ++this.seq });
    });
    connection.onreconnected(() => this._live.set(true));
    connection.onreconnecting(() => this._live.set(false));
    connection.onclose(() => {
      this._live.set(false);
      // Cleared so a later `ensureStarted` builds a fresh connection rather than
      // reusing a closed one, which throws instead of reconnecting.
      this.connection = null;
      this.starting = null;
    });

    this.connection = connection;
    this.starting = connection
      .start()
      .then(() => {
        this._live.set(true);
      })
      .catch(() => {
        this._live.set(false);
        this.connection = null;
      })
      .finally(() => {
        this.starting = null;
      });
  }
}
