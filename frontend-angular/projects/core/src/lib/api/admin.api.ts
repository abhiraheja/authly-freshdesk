import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

/** Where a workspace's attachments live. */
export type StorageProvider = 'local' | 'azure' | 'gcs';

/**
 * Credentials are never sent back by the server — only whether one is stored
 * (invariant 3). The screen shows "configured" and offers to replace it.
 */
export interface StorageConfig {
  readonly provider: StorageProvider;
  readonly azureContainer: string | null;
  readonly hasAzureConnectionString: boolean;
  readonly gcsBucket: string | null;
  readonly hasGcsCredentials: boolean;
  /** Folder inside the bucket everything is written under, e.g. `trackly`. */
  readonly pathPrefix: string | null;
  /**
   * CDN origin in front of the bucket. Only assets written as public — today
   * workspace logos alone — are ever given one of these URLs. Trackly never
   * produces one for an attachment, because a CDN link carries no sign-in.
   */
  readonly publicBaseUrl: string | null;
  readonly lastVerifiedAt: string | null;
  readonly updatedAt: string;
}

/**
 * A secret field left `undefined` keeps what is stored, `''` clears it, and any
 * other value replaces it. That is what lets the form round-trip without ever
 * having seen the existing credential.
 */
export interface StorageConfigBody {
  provider: StorageProvider;
  azureConnectionString?: string;
  azureContainer?: string;
  gcsCredentialsJson?: string;
  gcsBucket?: string;
  pathPrefix?: string;
  publicBaseUrl?: string;
}

/** The probe result. `ok: false` carries the provider's own message. */
export interface StorageTestResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly provider?: StorageProvider;
  readonly verifiedAt?: string;
}

/**
 * A first-response and resolution target for one priority.
 *
 * Minutes on the wire, hours in the UI: the API stores what the clock actually
 * counts, and nobody sets an SLA in minutes. Null means "no target" — the clock
 * simply does not run for that leg.
 */
export interface SlaPolicy {
  readonly priority: string;
  readonly firstResponseMinutes: number | null;
  readonly resolveMinutes: number | null;
}

/**
 * When the desk is open, so an SLA deadline is a promise the team can keep.
 *
 * `isEnabled: false` means round-the-clock — the deadline is plain wall-clock
 * arithmetic, which is what every workspace gets until somebody turns this on.
 */
export interface BusinessHours {
  isEnabled: boolean;
  /** IANA zone. "9am" means the workspace's 9am, not the server's. */
  timeZone: string;
  /** Only OPEN days appear. A missing day is closed. */
  days: BusinessDay[];
  holidays: BusinessHoliday[];
}

/** `dayOfWeek` 0 = Sunday. Minutes from local midnight: 540 = 09:00. */
export interface BusinessDay {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface BusinessHoliday {
  id: string;
  /** ISO date, no time — a holiday is a day, not an instant. */
  date: string;
  name: string | null;
}

/**
 * How one agent did against the SLA.
 *
 * `attainment` is null — not zero — when nothing they finished had a target.
 * "0%" reads as failure and the truth is that no policy applied.
 */
export interface AgentSlaScore {
  agentId: string;
  name: string;
  resolved: number;
  firstResponseTracked: number;
  firstResponseMet: number;
  resolutionTracked: number;
  resolutionMet: number;
  attainment: number | null;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly api = inject(ApiService);

  slaPolicies(): Promise<SlaPolicy[]> {
    return this.api.get<SlaPolicy[]>('/api/admin/sla');
  }

  /** Upsert by priority — there is exactly one policy per priority. */
  saveSlaPolicy(policy: SlaPolicy): Promise<SlaPolicy> {
    return this.api.put<SlaPolicy>('/api/admin/sla', policy);
  }

  deleteSlaPolicy(priority: string): Promise<void> {
    return this.api.delete<void>(`/api/admin/sla/${priority}`);
  }

  // ── Business hours ────────────────────────────────────────────────────────

  /** Readable by agents: a countdown nobody can account for is one nobody trusts. */
  businessHours(): Promise<BusinessHours> {
    return this.api.get<BusinessHours>('/api/sla/hours');
  }

  /** Replaces the whole schedule — one call, one transaction. */
  saveBusinessHours(body: {
    isEnabled: boolean;
    timeZone: string;
    days: BusinessDay[];
  }): Promise<BusinessHours> {
    return this.api.put<BusinessHours>('/api/sla/hours', body);
  }

  addHoliday(date: string, name?: string | null): Promise<BusinessHoliday> {
    return this.api.post<BusinessHoliday>('/api/sla/holidays', { date, name });
  }

  removeHoliday(id: string): Promise<void> {
    return this.api.delete<void>(`/api/sla/holidays/${id}`);
  }

  /** Counted, never scored — see the service for why there is no points number. */
  slaScorecard(days = 30): Promise<AgentSlaScore[]> {
    return this.api.get<AgentSlaScore[]>('/api/sla/scorecard', { days });
  }

  storage(): Promise<StorageConfig> {
    return this.api.get<StorageConfig>('/api/admin/settings/storage');
  }

  saveStorage(body: StorageConfigBody): Promise<StorageConfig> {
    return this.api.put<StorageConfig>('/api/admin/settings/storage', body);
  }

  /**
   * Round-trips a probe file through the SAVED settings, so it has to be called
   * after a save rather than against whatever is currently typed in the form.
   */
  testStorage(): Promise<StorageTestResult> {
    return this.api.post<StorageTestResult>('/api/admin/settings/storage/test', {});
  }
}
