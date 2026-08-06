import { Injectable, inject } from '@angular/core';
import { ApiService, type QueryParams } from './api.service';

export interface Category {
  id: string;
  name: string;
  color: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

export interface UserSummary {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
}

export interface TicketSummary {
  id: string;
  subject: string;
  status: string;
  priority: string;
  channel: string;
  category: Category | null;
  requester: UserSummary | null;
  guestName: string | null;
  guestEmail: string | null;
  assignee: UserSummary | null;
  commentCount: number;
  tags: Tag[];
  firstResponseDueAt: string | null;
  resolveDueAt: string | null;
  firstResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Watcher {
  agent: UserSummary;
  addedAt: string;
}

export interface TicketDetail extends Omit<TicketSummary, 'commentCount'> {
  description: string;
  watchers: Watcher[];
  problemId: string | null;
  teamId: string | null;
  teamName: string | null;
}

export interface Attachment {
  id: string;
  commentId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Comment {
  id: string;
  author: UserSummary | null;
  guestEmail: string | null;
  body: string;
  /**
   * Private note. The API filters these out for every non-agent caller — the
   * amber styling in the UI is a second signal for agents, never the control
   * (invariant 5).
   */
  isInternal: boolean;
  source: string;
  attachments: Attachment[];
  createdAt: string;
}

export interface DashboardStats {
  total: number;
  open: number;
  pending: number;
  resolved: number;
  closed: number;
  unassigned: number;
  assignedToMe: number;
  openProblems: number;
}

export interface TicketListParams {
  status?: string;
  priority?: string;
  assigneeId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface UpdateTicketBody {
  subject?: string;
  status?: string;
  priority?: string;
  categoryId?: string;
  clearCategory?: boolean;
  assigneeId?: string;
  unassign?: boolean;
  teamId?: string;
  clearTeam?: boolean;
}

@Injectable({ providedIn: 'root' })
export class TicketsApi {
  private readonly api = inject(ApiService);

  stats(): Promise<DashboardStats> {
    return this.api.get<DashboardStats>('/api/dashboard/stats');
  }

  list(params: TicketListParams = {}): Promise<Paged<TicketSummary>> {
    return this.api.get<Paged<TicketSummary>>('/api/tickets', params as QueryParams);
  }

  get(id: string): Promise<TicketDetail> {
    return this.api.get<TicketDetail>(`/api/tickets/${id}`);
  }

  create(body: {
    subject: string;
    description: string;
    categoryId?: string;
    priority?: string;
  }): Promise<TicketDetail> {
    return this.api.post<TicketDetail>('/api/tickets', body);
  }

  update(id: string, body: UpdateTicketBody): Promise<TicketDetail> {
    return this.api.patch<TicketDetail>(`/api/tickets/${id}`, body);
  }

  comments(ticketId: string): Promise<Comment[]> {
    return this.api.get<Comment[]>(`/api/tickets/${ticketId}/comments`);
  }

  addComment(ticketId: string, body: { body: string; isInternal: boolean }): Promise<Comment> {
    return this.api.post<Comment>(`/api/tickets/${ticketId}/comments`, body);
  }

  setTags(id: string, tags: string[]): Promise<Tag[]> {
    return this.api.put<Tag[]>(`/api/tickets/${id}/tags`, { tags });
  }

  addWatcher(ticketId: string, agentId: string): Promise<void> {
    return this.api.put<void>(`/api/tickets/${ticketId}/watchers/${agentId}`);
  }

  removeWatcher(ticketId: string, agentId: string): Promise<void> {
    return this.api.delete<void>(`/api/tickets/${ticketId}/watchers/${agentId}`);
  }

  categories(): Promise<Category[]> {
    return this.api.get<Category[]>('/api/categories');
  }

  agents(): Promise<UserSummary[]> {
    return this.api.get<UserSummary[]>('/api/users', { role: 'agent' });
  }

  attachments(ticketId: string): Promise<Attachment[]> {
    return this.api.get<Attachment[]>(`/api/tickets/${ticketId}/attachments`);
  }

  uploadAttachment(ticketId: string, file: File, commentId?: string): Promise<Attachment> {
    const form = new FormData();
    form.append('file', file);
    return this.api.upload<Attachment>(`/api/tickets/${ticketId}/attachments`, form, { commentId });
  }

  attachmentUrl(id: string): string {
    return this.api.url(`/api/attachments/${id}`);
  }
}

/**
 * The most urgent SLA state for a ticket, or `null` when no clock applies.
 *
 * An unmet first response outranks the resolve clock; resolved and closed
 * tickets have no active clock at all. Overdue is reported as elapsed time with
 * an explicit label — never a negative countdown, which reads as a bug.
 */
export function slaState(
  ticket: Pick<TicketSummary, 'status' | 'firstResponseDueAt' | 'resolveDueAt' | 'firstResponseAt'>,
): { tone: 'success' | 'warning' | 'danger'; label: string; prefix: string } | null {
  if (ticket.firstResponseDueAt && !ticket.firstResponseAt) {
    return { ...remaining(ticket.firstResponseDueAt), prefix: 'Response' };
  }
  if (ticket.resolveDueAt && ticket.status !== 'resolved' && ticket.status !== 'closed') {
    return { ...remaining(ticket.resolveDueAt), prefix: 'Resolve' };
  }
  return null;
}

function remaining(dueAt: string): { tone: 'success' | 'warning' | 'danger'; label: string } {
  const minutes = Math.round((new Date(dueAt).getTime() - Date.now()) / 60_000);
  if (minutes < 0) return { tone: 'danger', label: `Overdue ${short(-minutes)}` };
  return { tone: minutes <= 60 ? 'warning' : 'success', label: `in ${short(minutes)}` };
}

function short(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
