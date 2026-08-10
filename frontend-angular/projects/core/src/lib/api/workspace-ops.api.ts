import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

// ── Announcements ───────────────────────────────────────────────────────────

/**
 * What kind of thing is being announced. The type is not decoration: a customer
 * scanning their inbox reads it before the subject, and "we are down" and "we
 * are back" are the two they most need to tell apart.
 */
export const ANNOUNCEMENT_TYPES = [
  'unplanned_outage',
  'planned_outage',
  'resolved',
  'general',
] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

export interface AnnouncementSummary {
  id: string;
  type: string;
  subject: string;
  /** Set when the announcement was raised from a Problem. */
  problemId: string | null;
  scheduledAt: string | null;
  /** Null until it actually went out. This is the only "has it sent?" flag. */
  sentAt: string | null;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
}

export interface AnnouncementDetail extends AnnouncementSummary {
  body: string;
}

export interface CreateAnnouncementBody {
  type: string;
  subject: string;
  body: string;
  problemId?: string;
  /** ISO instant. Omit to leave it as a draft you send by hand. */
  scheduledAt?: string;
}

// ── Automation ──────────────────────────────────────────────────────────────

export const AUTOMATION_TRIGGERS = ['on_create', 'on_update'] as const;
export const AUTOMATION_FIELDS = ['priority', 'status', 'channel', 'category', 'subject'] as const;
export const AUTOMATION_OPS = ['equals', 'not_equals', 'contains'] as const;
export const AUTOMATION_ACTIONS = [
  'set_priority',
  'set_status',
  'assign_team',
  'add_tag',
  'add_note',
] as const;

export interface AutomationCondition {
  field: string;
  op: string;
  value: string | null;
}

export interface AutomationAction {
  type: string;
  value: string | null;
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  /** **All** must match. There is no "any" — see the rule editor's hint. */
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
  /** Rules run in this order, lowest first. */
  sortOrder: number;
}

export interface SaveAutomationRule {
  name: string;
  trigger: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
  sortOrder: number;
}

/**
 * Two admin surfaces that operate on the workspace rather than on a ticket:
 * broadcast announcements, and the automation rules that run inside every
 * create and update.
 *
 * Kept out of `admin.api.ts` (settings) and `tickets.api.ts` (one ticket at a
 * time) because they are neither: both act on the whole workspace at once, and
 * both are admin-only server-side.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceOpsApi {
  private readonly api = inject(ApiService);

  announcements(): Promise<AnnouncementSummary[]> {
    return this.api.get<AnnouncementSummary[]>('/api/announcements');
  }

  announcement(id: string): Promise<AnnouncementDetail> {
    return this.api.get<AnnouncementDetail>(`/api/announcements/${id}`);
  }

  createAnnouncement(body: CreateAnnouncementBody): Promise<AnnouncementDetail> {
    return this.api.post<AnnouncementDetail>('/api/announcements', body);
  }

  /**
   * Sends now, whatever the schedule said.
   *
   * There is no unsend and no edit-after-send — mail is gone the moment it
   * leaves — so every caller of this confirms first.
   */
  sendAnnouncement(id: string): Promise<AnnouncementDetail> {
    return this.api.post<AnnouncementDetail>(`/api/announcements/${id}/send`, {});
  }

  automationRules(): Promise<AutomationRule[]> {
    return this.api.get<AutomationRule[]>('/api/automation-rules');
  }

  createAutomationRule(body: SaveAutomationRule): Promise<AutomationRule> {
    return this.api.post<AutomationRule>('/api/automation-rules', body);
  }

  updateAutomationRule(id: string, body: SaveAutomationRule): Promise<AutomationRule> {
    return this.api.put<AutomationRule>(`/api/automation-rules/${id}`, body);
  }

  deleteAutomationRule(id: string): Promise<void> {
    return this.api.delete<void>(`/api/automation-rules/${id}`);
  }
}
