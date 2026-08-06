import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Query-string values a caller may pass; `undefined` and `''` are dropped. */
export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/**
 * The single HTTP entry point for every Trackly API call.
 *
 * Methods return promises rather than observables because feature state is built
 * on `resource()`, whose loader is promise-based. Errors arrive as `ApiError`
 * (see `http.interceptors.ts`), never `HttpErrorResponse`.
 *
 * Never inject `HttpClient` directly in a feature — go through a typed `*.api.ts`
 * that wraps this service, so request shapes stay in one place per domain.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: QueryParams): Promise<T> {
    return firstValueFrom(this.http.get<T>(this.url(path), { params: toHttpParams(params) }));
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.url(path), body ?? {}));
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(this.url(path), body ?? {}));
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(this.url(path), body ?? {}));
  }

  delete<T>(path: string, params?: QueryParams): Promise<T> {
    return firstValueFrom(this.http.delete<T>(this.url(path), { params: toHttpParams(params) }));
  }

  /**
   * Multipart upload. Content-Type is deliberately unset — the browser must add
   * it itself so the multipart boundary is correct.
   */
  upload<T>(path: string, form: FormData, params?: QueryParams): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.url(path), form, { params: toHttpParams(params) }));
  }

  /** Absolute URL for links the browser fetches directly (attachments, exports). */
  url(path: string): string {
    return `${environment.apiBaseUrl}${path}`;
  }
}

function toHttpParams(params?: QueryParams): HttpParams {
  let result = new HttpParams();
  if (!params) return result;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    result = result.set(key, String(value));
  }
  return result;
}
