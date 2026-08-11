/*
 * @trackly/releases — release plans.
 *
 * The document a team used to keep in a wiki per deployment: which services go
 * out, which pipeline runs, which migration to run, which variables change, and
 * which tasks ship — except every line carries a tick, a name and a timestamp,
 * so the same page is also the instrument the release is run from.
 */

export * from './lib/releases.routes';
export * from './lib/release-list';
export * from './lib/release-detail';
