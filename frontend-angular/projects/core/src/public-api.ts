/*
 * @trackly/core — the framework layer. No UI, no templates.
 *
 * Everything a feature needs that isn't a component: the HTTP client, typed API
 * services, the session, route guards, the theme, and the semantic tone maps.
 *
 * Depends on nothing else in this workspace. Every other library depends on it.
 */

// Configuration — the app hands environment values down; a library never reads
// the app's `environment.ts` itself.
export * from './lib/core.config';

// HTTP
export * from './lib/api/api-error';
export * from './lib/api/api.service';
export * from './lib/api/http.interceptors';

// Typed endpoints
export * from './lib/api/public.api';
export * from './lib/api/tickets.api';
export * from './lib/auth/auth.api';

// Session + routing
export * from './lib/auth/auth.models';
export * from './lib/auth/session.store';
export * from './lib/auth/guards';

// Theme + formatting
export * from './lib/theme/theme.service';
export * from './lib/format';
export * from './lib/resource-utils';
