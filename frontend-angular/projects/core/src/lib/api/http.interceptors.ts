import type { HttpInterceptorFn } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { toApiError } from './api-error';

/**
 * Sends the session cookie with every API call.
 *
 * Trackly's session is an HttpOnly cookie, not a bearer token, so there is no
 * Authorization header to attach anywhere in this app. Same-origin requests
 * would carry the cookie regardless; this exists so a split-origin setup (a
 * separately hosted SPA against a CORS-credentialed API) works without touching
 * every call site.
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));

/**
 * One choke point that turns every transport failure into an {@link ApiError},
 * so no feature ever has to know about `HttpErrorResponse`.
 */
export const apiErrorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((err: unknown) =>
      throwError(() => (err instanceof HttpErrorResponse ? toApiError(err) : err)),
    ),
  );
