/*
 * @trackly/auth — the way into the product: passwordless sign-in, magic-link
 * verification, SSO hand-off and workspace onboarding.
 *
 * **Only the route table is exported.** The host spreads `authRoutes` into its
 * own config (these screens live at top-level URLs like /login, so they cannot
 * be mounted under a path prefix), which means this barrel is imported
 * *eagerly*. Re-exporting components here would drag them into the initial
 * bundle; the routes load them lazily instead.
 *
 * If another library ever needs `AuthLayout`, give it a secondary entry point
 * rather than adding it back here.
 */

export * from './lib/auth.routes';
