import { Injectable, computed, inject, signal } from '@angular/core';
import { ChatApi, type ChatSession, type HubConnection } from './api/chat.api';

/**
 * "Somebody is waiting in chat" — for agents who are not looking at the console.
 *
 * A chat is the one thing in Trackly where the person is **still there**. An
 * email can wait an hour; a visitor staring at a window cannot, and an agent who
 * has to keep `/dashboard/chat` open to find out is an agent who will miss it.
 *
 * **Pushed, not polled** — unlike the notification bell, which is deliberately a
 * once-a-minute poll. The difference is the deadline: a minute of latency on
 * "you were mentioned" costs nothing, and a minute of silence on a live chat is
 * the whole conversation. The lobby connection already exists for the console;
 * this holds one open for the shell instead, for as long as an agent is signed
 * in.
 *
 * Started by the app shell, which only ever renders for an agent or an admin —
 * so a customer or a guest never opens a lobby connection they have no business
 * being in. The hub refuses anyway (it puts non-staff in the visitor branch);
 * this just avoids asking.
 */
@Injectable({ providedIn: 'root' })
export class ChatPresence {
  private readonly api = inject(ChatApi);

  private connection: HubConnection | null = null;

  /**
   * Sessions that want an agent: nobody has answered yet, or the visitor has
   * written since anyone last opened it.
   *
   * A set rather than a counter, because the same chat can be nudged repeatedly
   * — three impatient messages are still one person waiting, and a badge that
   * climbed to 3 would say something false about the size of the queue.
   */
  private readonly pending = signal<ReadonlySet<string>>(new Set());

  /** The badge on the Live chat row. */
  readonly waiting = computed(() => this.pending().size);

  /**
   * The most recent arrival, for the shell to announce. The consumer clears it
   * — a signal that stayed set would re-announce on every change detection.
   */
  readonly arrived = signal<ChatSession | null>(null);

  /** Live delivery is up. False means the badge may be stale. */
  readonly connected = signal(false);

  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // The current queue, before any events: an agent signing in to four chats
    // that started while they were away must see four, not zero.
    await this.seed();

    const connection = this.api.connect();
    this.connection = connection;

    connection.on('session', (session: ChatSession) => {
      this.add(session.id);
      this.arrived.set(session);
    });

    // A follow-up on a chat somebody already answered. Broadcast to the lobby by
    // the API precisely so an agent who moved on still finds out.
    connection.on('visitorMessage', (event: { sessionId: string }) => this.add(event.sessionId));

    connection.on('ended', (event: { sessionId: string }) => this.remove(event.sessionId));

    connection.onreconnected(() => {
      this.connected.set(true);
      // Whatever happened while the socket was down is only in the database.
      void this.seed();
    });
    connection.onreconnecting(() => this.connected.set(false));
    connection.onclose(() => this.connected.set(false));

    try {
      await connection.start();
      this.connected.set(true);
    } catch {
      // The badge still works off the seed; it just stops updating on its own.
      this.connected.set(false);
    }
  }

  stop(): void {
    const connection = this.connection;
    this.connection = null;
    this.started = false;
    this.connected.set(false);
    this.pending.set(new Set());
    void connection?.stop().catch(() => {});
  }

  /** An agent opened this chat, so it is no longer waiting on anyone. */
  markSeen(sessionId: string): void {
    this.remove(sessionId);
  }

  private async seed(): Promise<void> {
    try {
      const sessions = await this.api.sessions();
      // Unanswered only. A chat an agent is already in the middle of is not
      // something to interrupt the rest of the team about.
      this.pending.set(new Set(sessions.filter((s) => !s.agentId).map((s) => s.id)));
    } catch {
      // Leave the last known set: a blank badge because a request blinked reads
      // as "nobody waiting", which is the one wrong answer that costs something.
    }
  }

  private add(sessionId: string): void {
    this.pending.update((current) => {
      if (current.has(sessionId)) return current;
      const next = new Set(current);
      next.add(sessionId);
      return next;
    });
  }

  private remove(sessionId: string): void {
    this.pending.update((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
  }
}
