import { HttpClient, HttpEventType, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { filter, firstValueFrom, map, tap } from 'rxjs';
import { TRACKLY_CONFIG } from '../core.config';

/** Bytes sent so far. `percent` is -1 while the total length is unknown. */
export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadOptions {
  params?: QueryParams;
  /** Called repeatedly while the body is on the wire, then once at 100. */
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * Query-string values a caller may pass; `undefined` and `''` are dropped.
 *
 * An array becomes **repeated params** (`?status=open&status=pending`), which is
 * what a list-typed parameter binds from server-side.
 */
export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null | readonly (string | number)[]
>;

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
  private readonly config = inject(TRACKLY_CONFIG);

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
   *
   * Every upload in the app goes through here, so the progress plumbing and the
   * boundary rule live in one place. Pass `onProgress` to drive a progress bar;
   * without it this behaves exactly like `post`.
   */
  upload<T>(path: string, form: FormData, options?: UploadOptions): Promise<T> {
    const request = { params: toHttpParams(options?.params) };
    if (!options?.onProgress)
      return firstValueFrom(this.http.post<T>(this.url(path), form, request));

    // `observe: 'events'` changes the stream to every lifecycle event, so the
    // final response has to be picked out of it — and `reportProgress` is what
    // makes the browser emit UploadProgress at all.
    return firstValueFrom(
      this.http
        .post<T>(this.url(path), form, { ...request, observe: 'events', reportProgress: true })
        .pipe(
          tap((event) => {
            if (event.type !== HttpEventType.UploadProgress) return;
            // `total` is absent on a chunked body. Report -1 rather than a made-up
            // denominator so the bar can switch to indeterminate instead of lying.
            const total = event.total ?? 0;
            options.onProgress!({
              loaded: event.loaded,
              total,
              percent: total > 0 ? Math.round((event.loaded / total) * 100) : -1,
            });
          }),
          filter((event) => event.type === HttpEventType.Response),
          map((event) => event.body as T),
        ),
    );
  }

  /** Absolute URL for links the browser fetches directly (attachments, exports). */
  url(path: string): string {
    return `${this.config.apiBaseUrl}${path}`;
  }
}

function toHttpParams(params?: QueryParams): HttpParams {
  let result = new HttpParams();
  if (!params) return result;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;

    // `append`, not `set`, and one call per element. `String(['a','b'])` is
    // "a,b" — a single value that a list-typed parameter binds as one string
    // containing a comma, so every multi-select filter would silently match
    // nothing. Repeated params are what the server actually reads.
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue;
        result = result.append(key, String(item));
      }
      continue;
    }

    result = result.set(key, String(value));
  }
  return result;
}
