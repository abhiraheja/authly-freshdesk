import { HttpErrorResponse } from '@angular/common/http';

/**
 * A failed API call, normalised to `{ status, message }`.
 *
 * Branch on `status`, never on `message` — the text is server copy and will
 * change, the code will not.
 *
 * ```ts
 * catch (e) {
 *   if (e instanceof ApiError && e.status === 403) { … }
 * }
 * ```
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The error envelope every Trackly endpoint returns: `{ "error": "…" }`. */
interface ErrorEnvelope {
  error?: string;
}

/** Converts Angular's HttpErrorResponse into an {@link ApiError}. */
export function toApiError(response: HttpErrorResponse): ApiError {
  // Status 0 means the request never reached the server (offline, DNS, CORS).
  if (response.status === 0) {
    return new ApiError(0, 'Could not reach the server. Check your connection.');
  }

  const body = response.error as ErrorEnvelope | string | null;
  if (typeof body === 'string' && body.trim()) {
    return new ApiError(response.status, body.trim());
  }
  if (body && typeof body === 'object' && typeof body.error === 'string' && body.error.trim()) {
    return new ApiError(response.status, body.error.trim());
  }
  return new ApiError(response.status, `Request failed (${response.status})`);
}

/** Pulls a message out of anything thrown, for display in an alert or toast. */
export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
