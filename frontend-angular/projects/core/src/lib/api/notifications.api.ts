import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import type { UserSummary } from './tickets.api';

/** What happened. The client renders the sentence — the server never sends one. */
export type NotificationType = 'mention' | 'watching' | 'assigned' | 'reply';

export interface AppNotification {
  id: string;
  type: string;
  ticketId: string | null;
  /** The subject, not the id: the bell is read at a glance. */
  ticketSubject: string | null;
  actor: UserSummary | null;
  /** A short plain-text extract. Never markup. */
  preview: string | null;
  isRead: boolean;
  createdAt: string;
}

/**
 * The bell.
 *
 * Holds the unread count in a signal rather than a `resource()` because it has
 * two writers: the poll below, and every read the user performs. A resource
 * would have to be reloaded after each of those, which is a round trip to learn
 * a number this side already knows.
 *
 * Nothing here takes a user id. There is no shape of request that could ask for
 * somebody else's notifications, which is the point.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsApi {
  private readonly api = inject(ApiService);

  /** Read by the badge. Updated by `refreshCount()` and by marking things read. */
  readonly unread = signal(0);

  list(unreadOnly = false): Promise<AppNotification[]> {
    return this.api.get<AppNotification[]>('/api/notifications', { unreadOnly });
  }

  async refreshCount(): Promise<void> {
    try {
      const { count } = await this.api.get<{ count: number }>('/api/notifications/unread-count');
      this.unread.set(count);
    } catch {
      // A failed poll leaves the last known count. Showing a zero because the
      // network blinked would be worse than showing a stale number.
    }
  }

  async markRead(id: string): Promise<void> {
    await this.api.post<void>(`/api/notifications/${id}/read`);
    // Decremented locally rather than re-fetched: the answer is known, and the
    // badge should not lag a round trip behind the click that changed it.
    this.unread.update((n) => Math.max(0, n - 1));
  }

  async markAllRead(): Promise<void> {
    await this.api.post<void>('/api/notifications/read-all');
    this.unread.set(0);
  }
}
