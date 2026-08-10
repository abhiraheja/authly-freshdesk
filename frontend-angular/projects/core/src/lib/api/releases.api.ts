import { Injectable, inject } from '@angular/core';
import { HubConnectionBuilder, LogLevel, type HubConnection } from '@microsoft/signalr';
import { ApiService } from './api.service';
import { TRACKLY_CONFIG } from '../core.config';
import type { UserSummary } from './tickets.api';

/**
 * A release moves along one line and does not come back — except for the one
 * step backwards from `ready` to `planning`, which is what noticing a gap while
 * the plan is still on the ground looks like.
 */
export const RELEASE_STATUSES = [
  'planning',
  'ready',
  'in_progress',
  'released',
  'rolled_back',
  'cancelled',
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASE_COMPONENT_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'failed',
  'skipped',
] as const;

export const RELEASE_STEP_STATUSES = ['pending', 'done', 'failed', 'skipped'] as const;

/**
 * The five things a runbook line can be. `env_change` is the one that carries a
 * rule with it: the plan records the variable NAME and where it is set, never
 * the value — see the step form, which has no value field at all.
 */
export const RELEASE_STEP_KINDS = [
  'pipeline',
  'db_script',
  'env_change',
  'manual',
  'verify',
] as const;
export type ReleaseStepKind = (typeof RELEASE_STEP_KINDS)[number];

/** Used for both passes — pre-deploy on staging, and post-deploy on production. */
export const RELEASE_TEST_STATUSES = [
  'not_tested',
  'passed',
  'failed',
  'blocked',
  'skipped',
] as const;
export type ReleaseTestStatus = (typeof RELEASE_TEST_STATUSES)[number];

export interface ReleaseSummary {
  id: string;
  version: string;
  title: string | null;
  status: string;
  scheduledAt: string | null;
  releaseManager: UserSummary | null;
  componentCount: number;
  componentsDone: number;
  stepCount: number;
  stepsDone: number;
  workItemCount: number;
  /** Passed or consciously skipped — the two that let a release go out. */
  workItemsTested: number;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseStep {
  id: string;
  kind: string;
  title: string;
  /** The SQL, the command, the instruction. Never a secret value. */
  body: string | null;
  targetEnv: string | null;
  url: string | null;
  sequence: number;
  status: string;
  doneBy: UserSummary | null;
  doneAt: string | null;
  result: string | null;
}

export interface ReleaseWorkItem {
  id: string;
  componentId: string | null;
  externalKey: string | null;
  /**
   * Resolved server-side from the explicit URL or the workspace's template, so
   * no client has to know the template — and a task nobody can open is a task
   * nobody but its author can test.
   */
  url: string | null;
  ticketId: string | null;
  ticketSubject: string | null;
  title: string;
  testStatus: string;
  testedBy: UserSummary | null;
  testedAt: string | null;
  testNotes: string | null;
  verifyStatus: string;
  verifiedBy: UserSummary | null;
  verifiedAt: string | null;
  sequence: number;
}

export interface ReleaseComponent {
  id: string;
  serviceId: string | null;
  /** Snapshotted when it was added — renaming the catalogue never rewrites history. */
  name: string;
  buildVersion: string | null;
  pipelineUrl: string | null;
  owner: UserSummary | null;
  sequence: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  completedBy: UserSummary | null;
  notes: string | null;
  steps: ReleaseStep[];
  workItems: ReleaseWorkItem[];
}

export interface ReleaseActivity {
  id: string;
  actor: UserSummary | null;
  /** A verb code — the sentence is built from a translation key in the UI. */
  action: string;
  detail: string | null;
  createdAt: string;
}

export interface ReleaseBlocker {
  code: string;
  count: number;
}

export interface ReleaseReadiness {
  canMarkReady: boolean;
  blockers: ReleaseBlocker[];
}

export interface ReleaseDetail {
  id: string;
  version: string;
  title: string | null;
  status: string;
  scheduledAt: string | null;
  releaseManager: UserSummary | null;
  notes: string | null;
  rollbackPlan: string | null;
  startedAt: string | null;
  releasedAt: string | null;
  createdBy: UserSummary | null;
  components: ReleaseComponent[];
  /** Tasks not filed under any component. Rendered last. */
  looseWorkItems: ReleaseWorkItem[];
  activity: ReleaseActivity[];
  readiness: ReleaseReadiness;
  /** Linked Trackly tickets still open — the number the "resolve them too?" question needs. */
  openTicketCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseSettings {
  /** Contains `{id}`, replaced by the task number. Null when unset. */
  workItemUrlTemplate: string | null;
}

export interface CreateReleaseBody {
  version: string;
  title?: string | null;
  scheduledAt?: string | null;
  releaseManagerId?: string | null;
  notes?: string | null;
  rollbackPlan?: string | null;
}

export interface UpdateReleaseBody {
  version?: string;
  title?: string | null;
  scheduledAt?: string | null;
  clearSchedule?: boolean;
  releaseManagerId?: string | null;
  clearManager?: boolean;
  notes?: string | null;
  rollbackPlan?: string | null;
}

export interface AddComponentBody {
  serviceId?: string | null;
  name?: string | null;
  buildVersion?: string | null;
  pipelineUrl?: string | null;
  ownerId?: string | null;
}

export interface UpdateComponentBody {
  name?: string;
  buildVersion?: string | null;
  pipelineUrl?: string | null;
  ownerId?: string | null;
  clearOwner?: boolean;
  notes?: string | null;
  sequence?: number;
}

export interface AddStepBody {
  kind: string;
  title: string;
  body?: string | null;
  targetEnv?: string | null;
  url?: string | null;
}

export interface UpdateStepBody {
  kind?: string;
  title?: string;
  body?: string | null;
  targetEnv?: string | null;
  url?: string | null;
  sequence?: number;
}

export interface AddWorkItemBody {
  title: string;
  componentId?: string | null;
  externalKey?: string | null;
  externalUrl?: string | null;
  ticketId?: string | null;
}

export interface UpdateWorkItemBody {
  title?: string;
  componentId?: string | null;
  clearComponent?: boolean;
  externalKey?: string | null;
  externalUrl?: string | null;
  ticketId?: string | null;
  clearTicket?: boolean;
  sequence?: number;
}

/**
 * Release plans — what a wiki page per deployment was doing, with a tick, a name
 * and a timestamp on every line.
 *
 * Every mutation returns the **whole** release, because one tick can move three
 * things at once: the step, its component, and the release itself (the first
 * tick starts a `ready` release). A client that reassembled that locally would
 * be wrong on the one screen where four people are watching the same list.
 */
@Injectable({ providedIn: 'root' })
export class ReleasesApi {
  private readonly api = inject(ApiService);
  private readonly config = inject(TRACKLY_CONFIG);

  /**
   * A connection to the release hub, for a screen that wants live ticks.
   *
   * Delivery only — the REST call is still what changes anything, so a socket
   * that never connects costs a stale panel and never a lost tick. The caller
   * starts it, joins the release, and stops it on destroy.
   */
  connect(): HubConnection {
    return new HubConnectionBuilder()
      .withUrl(`${this.config.apiBaseUrl}${this.config.releaseHubPath}`)
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();
  }

  /** `status` accepts a real status or `open` — everything not yet finished. */
  list(status?: string): Promise<ReleaseSummary[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.api.get<ReleaseSummary[]>(`/api/releases${query}`);
  }

  get(id: string): Promise<ReleaseDetail> {
    return this.api.get<ReleaseDetail>(`/api/releases/${id}`);
  }

  create(body: CreateReleaseBody): Promise<ReleaseDetail> {
    return this.api.post<ReleaseDetail>('/api/releases', body);
  }

  update(id: string, body: UpdateReleaseBody): Promise<ReleaseDetail> {
    return this.api.patch<ReleaseDetail>(`/api/releases/${id}`, body);
  }

  /**
   * Going to `ready` or `in_progress` runs the readiness check server-side and
   * throws when it fails — the gate belongs to starting the deployment, so
   * skipping the `ready` label cannot skip the check.
   */
  setStatus(id: string, status: string, resolveTickets = false): Promise<ReleaseDetail> {
    return this.api.post<ReleaseDetail>(`/api/releases/${id}/status`, { status, resolveTickets });
  }

  /** Copies the shape, never the record. Work items and ticks do not carry over. */
  clone(id: string, body: { version: string; title?: string | null; scheduledAt?: string | null }) {
    return this.api.post<ReleaseDetail>(`/api/releases/${id}/clone`, body);
  }

  remove(id: string): Promise<void> {
    return this.api.delete<void>(`/api/releases/${id}`);
  }

  addComponent(id: string, body: AddComponentBody): Promise<ReleaseDetail> {
    return this.api.post<ReleaseDetail>(`/api/releases/${id}/components`, body);
  }

  updateComponent(componentId: string, body: UpdateComponentBody): Promise<ReleaseDetail> {
    return this.api.patch<ReleaseDetail>(`/api/releases/components/${componentId}`, body);
  }

  setComponentStatus(componentId: string, status: string, notes?: string): Promise<ReleaseDetail> {
    return this.api.post<ReleaseDetail>(`/api/releases/components/${componentId}/status`, {
      status,
      notes,
    });
  }

  removeComponent(componentId: string): Promise<ReleaseDetail> {
    return this.api.delete<ReleaseDetail>(`/api/releases/components/${componentId}`);
  }

  addStep(componentId: string, body: AddStepBody): Promise<ReleaseDetail> {
    return this.api.post<ReleaseDetail>(`/api/releases/components/${componentId}/steps`, body);
  }

  updateStep(stepId: string, body: UpdateStepBody): Promise<ReleaseDetail> {
    return this.api.patch<ReleaseDetail>(`/api/releases/steps/${stepId}`, body);
  }

  /**
   * `force` is the answer to "an earlier step is still pending — anyway?".
   * Without it the API replies 409 with `code: 'steps_out_of_order'`; with it
   * the override is written to the activity log.
   */
  setStepStatus(
    stepId: string,
    status: string,
    options?: { result?: string | null; force?: boolean },
  ): Promise<ReleaseDetail> {
    return this.api.post<ReleaseDetail>(`/api/releases/steps/${stepId}/status`, {
      status,
      result: options?.result,
      force: options?.force ?? false,
    });
  }

  removeStep(stepId: string): Promise<ReleaseDetail> {
    return this.api.delete<ReleaseDetail>(`/api/releases/steps/${stepId}`);
  }

  addWorkItem(id: string, body: AddWorkItemBody): Promise<ReleaseDetail> {
    return this.api.post<ReleaseDetail>(`/api/releases/${id}/items`, body);
  }

  updateWorkItem(itemId: string, body: UpdateWorkItemBody): Promise<ReleaseDetail> {
    return this.api.patch<ReleaseDetail>(`/api/releases/items/${itemId}`, body);
  }

  /** Pre-deploy, on staging. This is what gates the release. */
  setWorkItemTest(itemId: string, status: string, notes?: string | null): Promise<ReleaseDetail> {
    return this.api.post<ReleaseDetail>(`/api/releases/items/${itemId}/test`, { status, notes });
  }

  /** Post-deploy, on production. This is what decides a rollback. */
  setWorkItemVerify(itemId: string, status: string): Promise<ReleaseDetail> {
    return this.api.post<ReleaseDetail>(`/api/releases/items/${itemId}/verify`, { status });
  }

  removeWorkItem(itemId: string): Promise<ReleaseDetail> {
    return this.api.delete<ReleaseDetail>(`/api/releases/items/${itemId}`);
  }

  /** Which releases a ticket is shipping in — asked from the ticket screen. */
  forTicket(ticketId: string): Promise<ReleaseSummary[]> {
    return this.api.get<ReleaseSummary[]>(`/api/releases/for-ticket/${ticketId}`);
  }

  settings(): Promise<ReleaseSettings> {
    return this.api.get<ReleaseSettings>('/api/releases/settings');
  }

  saveSettings(body: ReleaseSettings): Promise<ReleaseSettings> {
    return this.api.put<ReleaseSettings>('/api/releases/settings', body);
  }
}
