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

/** `workspace_branding` — the record every customer surface and email wears. */
export interface WorkspaceBranding {
  hasLogo: boolean;
  primaryColor: string;
  pageTitle: string | null;
  welcomeText: string | null;
  footerText: string | null;
  hidePoweredBy: boolean;
}

export interface SaveBrandingBody {
  primaryColor?: string;
  pageTitle?: string | null;
  welcomeText?: string | null;
  footerText?: string | null;
  hidePoweredBy?: boolean;
}

/**
 * Admin-side widget management, plus the workspace branding record the widget
 * screen now owns.
 *
 * The two live on one service because they are edited on one screen
 * (docs/widget-plan.md § 4.2) — but they remain **two records**, and that is the
 * distinction the screen has to keep visible: the widget row is per-widget, the
 * branding row is worn by the login page, the portal, the knowledge base and the
 * header of every email Trackly sends.
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

  // ---- Workspace branding --------------------------------------------------

  branding(): Promise<WorkspaceBranding> {
    return this.api.get<WorkspaceBranding>('/api/admin/branding');
  }

  saveBranding(body: SaveBrandingBody): Promise<WorkspaceBranding> {
    return this.api.put<WorkspaceBranding>('/api/admin/branding', body);
  }

  uploadLogo(file: File): Promise<WorkspaceBranding> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.api.upload<WorkspaceBranding>('/api/admin/branding/logo', form);
  }
}
