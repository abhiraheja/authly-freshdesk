import { Injectable, inject } from '@angular/core';
import { ApiService, type QueryParams, type UploadProgress } from './api.service';

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

/** A workspace tag plus its usage — drives suggestion ordering. */
export interface TagUsage extends Tag {
  ticketCount: number;
}

/**
 * What the model thinks, for the agent to accept or ignore.
 *
 * `rationale` is not decoration — a suggestion with no stated reason is one an
 * agent can only take on faith, and these are applied to real customer tickets.
 */
export interface TriageSuggestion {
  priority: string;
  category: string | null;
  tags: string[];
  sentiment: string;
  rationale: string;
}

/**
 * A workspace vocabulary. Stored in `ticket_options` — the table predates
 * `customer_field` and the name stayed; the shape (workspace, kind, value,
 * label, order, active) fits all three unchanged.
 */
export type TicketOptionKind = 'priority' | 'channel' | 'customer_field';

/**
 * One admin-configured choice for a fixed-vocabulary ticket field.
 *
 * `value` is what sits on the ticket and what automation matches; `label` is
 * what people read. That split is what lets an admin rename an option without
 * rewriting stored tickets — so bind `value` and render `label`, never the
 * other way round.
 */
export interface TicketOption {
  id: string;
  kind: TicketOptionKind;
  value: string;
  label: string;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Ships with Trackly: relabel and deactivate yes, delete no. */
  isSystem: boolean;
}

/**
 * A department. Trackly calls these teams internally because they also carry
 * routing — a ticket filed into one is round-robin'd within its members.
 */
export interface Team {
  id: string;
  name: string;
  members: UserSummary[];
}

export interface UserSummary {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  /**
   * API path to their photo, or null for the initials fallback. Never a storage
   * URL — the server decides whether to stream the bytes or redirect to a CDN.
   */
  avatarUrl: string | null;
}

/**
 * Everything a workspace keeps about a customer.
 *
 * `customFields` is deliberately open: support desks track different things
 * (account number, plan, region), and a fixed schema would mean a migration
 * every time one of them needed another. Configuration defines *suggested*
 * keys; it never restricts what can be saved.
 */
export interface Customer extends UserSummary {
  phone: string | null;
  company: string | null;
  location: string | null;
  customFields: Record<string, string>;
}

/** Customer plus the counts the profile page shows. */
export interface CustomerDetail extends Customer {
  isActive: boolean;
  createdAt: string;
  totalTickets: number;
  openTickets: number;
}

export interface CustomerBody {
  email?: string;
  name?: string;
  phone?: string;
  company?: string;
  location?: string;
  customFields?: Record<string, string>;
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
  /** Every ticket raised by one customer — the profile page's history. */
  requesterId?: string;
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
  /** Re-points the ticket at a customer. */
  requesterId?: string;
  /** Detaches the customer, leaving none. */
  clearRequester?: boolean;
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

  /**
   * `categoryName`, `channel` and `tags` are free text the server resolves —
   * an existing row is reused, a new value is created, all inside this one
   * request. Nothing is written until the ticket itself is written, so a form
   * the user abandons leaves no stray taxonomy behind.
   *
   * The server honours these three for agents and admins only; a customer
   * posting from the portal has them ignored, not rejected.
   */
  create(body: {
    subject: string;
    description: string;
    categoryId?: string;
    categoryName?: string;
    channel?: string;
    priority?: string;
    tags?: string[];
    teamId?: string;
    /** File on a customer's behalf. Agent/admin only; ignored otherwise. */
    requesterId?: string;
  }): Promise<TicketDetail> {
    return this.api.post<TicketDetail>('/api/tickets', body);
  }

  /** Departments — teams double as the routing group a ticket is filed into. */
  teams(): Promise<Team[]> {
    return this.api.get<Team[]>('/api/teams');
  }

  createTeam(name: string): Promise<Team> {
    return this.api.post<Team>('/api/teams', { name });
  }

  renameTeam(id: string, name: string): Promise<Team> {
    return this.api.put<Team>(`/api/teams/${id}`, { name });
  }

  deleteTeam(id: string): Promise<void> {
    return this.api.delete<void>(`/api/teams/${id}`);
  }

  createCategory(body: { name: string; color?: string }): Promise<Category> {
    return this.api.post<Category>('/api/categories', body);
  }

  updateCategory(id: string, body: { name: string; color?: string }): Promise<Category> {
    return this.api.put<Category>(`/api/categories/${id}`, body);
  }

  deleteCategory(id: string): Promise<void> {
    return this.api.delete<void>(`/api/categories/${id}`);
  }

  /**
   * Adds a customer to the workspace. Get-or-create by email server-side, so
   * calling it for someone who already exists returns them rather than failing —
   * "add this customer" is one intention either way.
   */
  createCustomer(body: CustomerBody): Promise<Customer> {
    return this.api.post<Customer>('/api/users', body);
  }

  customer(id: string): Promise<CustomerDetail> {
    return this.api.get<CustomerDetail>(`/api/users/${id}`);
  }

  /**
   * Full profile replace. Unlike create, an omitted field CLEARS — this backs an
   * edit form where the agent can see what they are removing.
   */
  updateCustomer(id: string, body: CustomerBody): Promise<Customer> {
    return this.api.put<Customer>(`/api/users/${id}/profile`, body);
  }

  /** Workspace members, for the requester picker. */
  users(role?: string): Promise<UserSummary[]> {
    return this.api.get<UserSummary[]>('/api/users', role ? { role } : {});
  }

  /**
   * An admin-configured vocabulary. Pickers ask for the default (active only);
   * the admin screen passes `includeInactive` so a retired option can be
   * brought back.
   */
  ticketOptions(kind: TicketOptionKind, includeInactive = false): Promise<TicketOption[]> {
    return this.api.get<TicketOption[]>('/api/ticket-options', { kind, includeInactive });
  }

  createTicketOption(body: { kind: TicketOptionKind; label: string; color?: string }): Promise<TicketOption> {
    return this.api.post<TicketOption>('/api/ticket-options', body);
  }

  updateTicketOption(
    id: string,
    body: { label?: string; color?: string; sortOrder?: number; isActive?: boolean },
  ): Promise<TicketOption> {
    return this.api.put<TicketOption>(`/api/ticket-options/${id}`, body);
  }

  deleteTicketOption(id: string): Promise<void> {
    return this.api.delete<void>(`/api/ticket-options/${id}`);
  }

  /** Every tag in the workspace, with how many tickets carry it. */
  tags(): Promise<TagUsage[]> {
    return this.api.get<TagUsage[]>('/api/tags');
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

  uploadAttachment(
    ticketId: string,
    file: File,
    commentId?: string,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<Attachment> {
    const form = new FormData();
    form.append('file', file);
    return this.api.upload<Attachment>(`/api/tickets/${ticketId}/attachments`, form, {
      params: { commentId },
      onProgress,
    });
  }

  attachmentUrl(id: string): string {
    return this.api.url(`/api/attachments/${id}`);
  }

  /**
   * Replaces a person's photo. Returns the new `avatarUrl`, which carries a
   * version query so the browser drops the cached copy of the old one — the
   * path itself never changes, so without it the old photo stays on screen.
   */
  uploadAvatar(
    userId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<{ avatarUrl: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.api.upload<{ avatarUrl: string }>(`/api/users/${userId}/avatar`, form, { onProgress });
  }

  removeAvatar(userId: string): Promise<void> {
    return this.api.delete<void>(`/api/users/${userId}/avatar`);
  }

  /**
   * Whether the AI copilot is on for this workspace — a deployment key AND an
   * admin toggle. Agent-facing probe, so the UI can hide the ✨ actions without
   * exposing the admin settings endpoint.
   */
  aiAvailable(): Promise<{ available: boolean }> {
    return this.api.get<{ available: boolean }>('/api/ai/available');
  }

  /** A suggestion for the agent to accept or ignore. Never auto-applied. */
  triage(ticketId: string): Promise<TriageSuggestion> {
    return this.api.post<TriageSuggestion>(`/api/tickets/${ticketId}/ai/triage`);
  }
}

/**
 * The most urgent SLA state for a ticket, or `null` when no clock applies.
 *
 * An unmet first response outranks the resolve clock; resolved and closed
 * tickets have no active clock at all. Overdue is reported as elapsed time with
 * an explicit label — never a negative countdown, which reads as a bug.
 */
export interface SlaState {
  tone: 'success' | 'warning' | 'danger';
  /** `sla.inTime` or `sla.overdue` — resolved with `{ time }` where it renders. */
  labelKey: string;
  time: string;
  /** `sla.response` or `sla.resolve`. */
  prefixKey: string;
}

export function slaState(
  ticket: Pick<TicketSummary, 'status' | 'firstResponseDueAt' | 'resolveDueAt' | 'firstResponseAt'>,
): SlaState | null {
  if (ticket.firstResponseDueAt && !ticket.firstResponseAt) {
    return { ...remaining(ticket.firstResponseDueAt), prefixKey: 'sla.response' };
  }
  if (ticket.resolveDueAt && ticket.status !== 'resolved' && ticket.status !== 'closed') {
    return { ...remaining(ticket.resolveDueAt), prefixKey: 'sla.resolve' };
  }
  return null;
}

function remaining(dueAt: string): Omit<SlaState, 'prefixKey'> {
  const minutes = Math.round((new Date(dueAt).getTime() - Date.now()) / 60_000);
  if (minutes < 0) return { tone: 'danger', labelKey: 'sla.overdue', time: short(-minutes) };
  return {
    tone: minutes <= 60 ? 'warning' : 'success',
    labelKey: 'sla.inTime',
    time: short(minutes),
  };
}

function short(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
