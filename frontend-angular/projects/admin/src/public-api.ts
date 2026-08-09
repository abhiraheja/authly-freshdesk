/*
 * @trackly/admin — workspace administration: members, teams, SLA, automation,
 * channels, branding, SSO, AI settings.
 */

export * from './lib/admin.routes';

// Mounted at the app root rather than under /admin: the provider redirects the
// browser to it, so its URL has to be short, stable and outside the shell.
export * from './lib/email-oauth-callback';
