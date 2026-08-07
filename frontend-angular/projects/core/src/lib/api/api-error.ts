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

  // A Trackly envelope always wins — it is the only message written for a human.
  if (body && typeof body === 'object' && typeof body.error === 'string' && body.error.trim()) {
    return new ApiError(response.status, body.error.trim());
  }

  // Nothing behind the gateway. In production that is a real 502/503/504; in
  // development it is far more often the API simply not running, since the dev
  // proxy answers for it and so the request never reports status 0. Saying
  // "request failed" there sends people hunting through their own code for a
  // bug that is just a stopped process.
  if (response.status >= 502 && response.status <= 504) {
    return new ApiError(response.status, 'Could not reach the API. Is the server running?');
  }

  if (typeof body === 'string' && body.trim() && !body.trimStart().startsWith('<')) {
    return new ApiError(response.status, body.trim());
  }

  return new ApiError(response.status, `Request failed (${response.status})`);
}

/** Pulls a message out of anything thrown, for display in an alert or toast. */
export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
