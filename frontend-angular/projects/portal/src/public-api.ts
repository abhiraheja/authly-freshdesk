/*
 * @trackly/portal — the signed-in customer's ticket surfaces.
 *
 * The route table only. The three screens are reached through `loadComponent`
 * inside it, and re-exporting them here would pull all three into the chunk that
 * the first one loads — the barrel is what `loadChildren` imports.
 */

export * from './lib/portal.routes';
