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
