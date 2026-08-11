import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

/**
 * `workspace_branding` — the one record every customer-facing surface wears.
 *
 * The sign-in and verify screens, the portal, the knowledge base, guest ticket
 * views and the header of every email Trackly sends all read this. A widget may
 * override its own colour and logo (see `WidgetAdminApi`), and doing so never
 * writes back here.
 */
export interface WorkspaceBranding {
  hasLogo: boolean;
  hasSignInImage: boolean;
  primaryColor: string;
  pageTitle: string | null;
  welcomeText: string | null;
  footerText: string | null;
  hidePoweredBy: boolean;
  /** Doubles as the cache-buster for the asset URLs below. */
  updatedAt: string;
}

export interface SaveBrandingBody {
  primaryColor?: string;
  pageTitle?: string | null;
  welcomeText?: string | null;
  footerText?: string | null;
  hidePoweredBy?: boolean;
}

/**
 * The public URL an uploaded asset is served from.
 *
 * Slug-less on purpose: one deployment holds one workspace, and the server
 * resolves it (invariant 1). The version string is what makes a replaced logo
 * appear — the endpoint sends `max-age=300`, so without it an admin would
 * upload a new mark and keep seeing the old one for five minutes and conclude
 * the upload had failed.
 */
export function brandingAssetUrl(asset: 'logo' | 'sign-in-image', version: string): string {
  return `/api/public/${asset}?v=${encodeURIComponent(version)}`;
}

@Injectable({ providedIn: 'root' })
export class BrandingApi {
  private readonly api = inject(ApiService);

  get(): Promise<WorkspaceBranding> {
    return this.api.get<WorkspaceBranding>('/api/admin/branding');
  }

  save(body: SaveBrandingBody): Promise<WorkspaceBranding> {
    return this.api.put<WorkspaceBranding>('/api/admin/branding', body);
  }

  uploadLogo(file: File): Promise<WorkspaceBranding> {
    return this.api.upload<WorkspaceBranding>('/api/admin/branding/logo', formOf(file));
  }

  removeLogo(): Promise<WorkspaceBranding> {
    return this.api.delete<WorkspaceBranding>('/api/admin/branding/logo');
  }

  uploadSignInImage(file: File): Promise<WorkspaceBranding> {
    return this.api.upload<WorkspaceBranding>('/api/admin/branding/sign-in-image', formOf(file));
  }

  removeSignInImage(): Promise<WorkspaceBranding> {
    return this.api.delete<WorkspaceBranding>('/api/admin/branding/sign-in-image');
  }
}

function formOf(file: File): FormData {
  const form = new FormData();
  form.append('file', file, file.name);
  return form;
}
