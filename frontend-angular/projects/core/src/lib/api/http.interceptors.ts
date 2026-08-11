import type { HttpInterceptorFn } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { toApiError } from './api-error';
// From the store's own module, never through `widget.api`: this file is reached
// eagerly from `provideTracklyCore`, and importing the API client here would put
// its dependencies — SignalR among them — in every app's initial bundle.
import { WidgetVisitorStore } from './widget-visitor.store';

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
 * Attaches the widget visitor token, and **only** to the widget's own endpoints.
 *
 * The embedded panel has no session cookie — a visitor is anonymous, and the
 * token in `X-Trackly-Visitor` is the whole of their credential. Scoped by path
 * rather than attached everywhere: it is a bearer token for one surface, and a
 * token that travels on requests that do not need it is a token with more places
 * to leak from.
 */
export const widgetVisitorInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.includes('/api/public/widget/')) return next(req);
  const token = inject(WidgetVisitorStore).token();
  return next(token ? req.clone({ setHeaders: { 'X-Trackly-Visitor': token } }) : req);
};

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
