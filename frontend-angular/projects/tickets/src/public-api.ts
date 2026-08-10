/*
 * @trackly/tickets — the agent ticket surfaces: index, detail, composer.
 */

export * from './lib/tickets.routes';
export * from './lib/ticket-list';
export * from './lib/customer-list';
export * from './lib/customer-detail';
export * from './lib/customer-form';

// Ticket-derived screens that live outside /dashboard/tickets. They are exported
// individually because the host mounts each at its own top-level path — the same
// arrangement CustomerDetail already uses.
export * from './lib/my-tasks';
export * from './lib/asset-register';
export * from './lib/service-board';
export * from './lib/canned-responses';
export * from './lib/chat-console';
export * from './lib/problem-list';
export * from './lib/problem-detail';
