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
export * from './lib/api/admin.api';
export * from './lib/api/analytics.api';
export * from './lib/api/chat.api';
export * from './lib/api/email.api';
export * from './lib/api/notifications.api';
export * from './lib/api/public.api';
export * from './lib/api/releases.api';
export * from './lib/api/sso.api';
export * from './lib/api/tickets.api';
export * from './lib/api/widget.api';
export * from './lib/api/widget-admin.api';
export * from './lib/api/workspace-ops.api';
export * from './lib/auth/auth.api';

// Session + routing
export * from './lib/auth/auth.models';
export * from './lib/auth/session.store';
export * from './lib/auth/guards';

// Theme + formatting
export * from './lib/theme/theme.service';
// One brand-token helper, not two: `lib/brand.ts` (widget branch) and
// `lib/theme/brand-tokens.ts` (main) solved the same problem, and main's derives
// the full palette — tint, border, ink — where the widget's derived only the
// primary. Kept main's; the widget surfaces now import `brandTokens`.
export * from './lib/theme/brand-tokens';
export * from './lib/ui-prefs.store';
export * from './lib/chat-presence.store';
export * from './lib/format';
export * from './lib/resource-utils';
export * from './lib/route-params';
export * from './lib/upload/file-rules';
