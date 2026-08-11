import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

// ---- Wire types ------------------------------------------------------------
// Mirrors src/Trackly.Modules/Widgets/WidgetDtos.cs. Keep them in step.

export interface WidgetSummary {
  id: string;
  name: string;
  tagline: string | null;
  publicToken: string;
  isActive: boolean;
  identityVerificationEnabled: boolean;
  primaryColor: string | null;
  teamId: string | null;
  teamName: string | null;
  /** Derived from the visitor rows, so it is honest about an unused widget. */
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetDetail extends WidgetSummary {
  /** A logo of this widget's own. False inherits the workspace's. */
  hasLogo: boolean;
  greeting: string | null;
  hasSecretKey: boolean;
  /** `first4…last4`. Enough to tell two keys apart, not enough to sign with. */
  secretKeyMasked: string | null;
  hideLauncher: boolean;
  launchWidget: boolean;
  showWidgetForm: boolean;
  showCloseButton: boolean;
  showSendButton: boolean;
  requireEmailVerification: boolean;
  allowedOrigins: string[];
  embedType: string;
  theme: string;
  snippet: string;
}

/** Create and regenerate. The plaintext key exists here and nowhere else. */
export interface WidgetSecret {
  widget: WidgetDetail;
  secretKey: string;
}

export interface SaveWidgetBody {
  name?: string;
  tagline?: string | null;
  greeting?: string | null;
  isActive?: boolean;
  identityVerificationEnabled?: boolean;
  primaryColor?: string;
  teamId?: string | null;
  hideLauncher?: boolean;
  launchWidget?: boolean;
  showWidgetForm?: boolean;
  showCloseButton?: boolean;
  showSendButton?: boolean;
  requireEmailVerification?: boolean;
  allowedOrigins?: string[];
  /** Explicit clears — `null` on the fields above already means "unchanged". */
  clearTeam?: boolean;
  clearPrimaryColor?: boolean;
}

export interface VerifyJwtResult {
  valid: boolean;
  error: string | null;
  uniqueId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  claims: Record<string, string>;
}

/**
 * The public URL a widget's own logo is served from.
 *
 * Token-addressed, because that is the only identifier an embedding page holds,
 * and versioned for the same reason as the workspace assets: the endpoint sends
 * `max-age=300`, so a replaced logo would otherwise look like a failed upload.
 */
export function widgetLogoUrl(publicToken: string, version: string): string {
  return `/api/public/widget/${encodeURIComponent(publicToken)}/logo?v=${encodeURIComponent(version)}`;
}

/**
 * Admin-side widget management.
 *
 * **This service never writes `workspace_branding`.** A widget's colour and logo
 * are its own; unset, they inherit the workspace record edited at
 * `/admin/settings/branding`, which also dresses the sign-in page, the portal,
 * the knowledge base and every outbound email. Overriding one widget must not be
 * able to repaint all of those — see `BrandingApi` for the other record.
 */
@Injectable({ providedIn: 'root' })
export class WidgetAdminApi {
  private readonly api = inject(ApiService);

  list(): Promise<WidgetSummary[]> {
    return this.api.get<WidgetSummary[]>('/api/admin/widgets');
  }

  get(id: string): Promise<WidgetDetail> {
    return this.api.get<WidgetDetail>(`/api/admin/widgets/${id}`);
  }

  create(body: SaveWidgetBody): Promise<WidgetSecret> {
    return this.api.post<WidgetSecret>('/api/admin/widgets', body);
  }

  update(id: string, body: SaveWidgetBody): Promise<WidgetDetail> {
    return this.api.put<WidgetDetail>(`/api/admin/widgets/${id}`, body);
  }

  remove(id: string): Promise<void> {
    return this.api.delete<void>(`/api/admin/widgets/${id}`);
  }

  regenerateSecret(id: string): Promise<WidgetSecret> {
    return this.api.post<WidgetSecret>(`/api/admin/widgets/${id}/secret`, {});
  }

  verifyJwt(id: string, token: string): Promise<VerifyJwtResult> {
    return this.api.post<VerifyJwtResult>(`/api/admin/widgets/${id}/verify-jwt`, { token });
  }

  // ---- This widget's own logo ----------------------------------------------
  // widget_configs only. Clearing falls back to the workspace logo; it does not
  // delete it.

  uploadLogo(id: string, file: File): Promise<WidgetDetail> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.api.upload<WidgetDetail>(`/api/admin/widgets/${id}/logo`, form);
  }

  removeLogo(id: string): Promise<WidgetDetail> {
    return this.api.delete<WidgetDetail>(`/api/admin/widgets/${id}/logo`);
  }
}
