/*
 * @trackly/ui — the design system.
 *
 * Standalone, OnPush, signal-based components over the CSS token layer that the
 * host app loads (`src/styles.scss`). Depends only on @trackly/core, and only
 * for the `Tone` type.
 *
 * Import from the package, never from a component's own path:
 *   import { Button, Card, Badge } from '@trackly/ui';
 */

export * from './lib/icon/icon';
export * from './lib/button/button';
export * from './lib/card/card';
export * from './lib/badge/badge';
export * from './lib/avatar/avatar';
export * from './lib/forms/input';
export * from './lib/feedback/feedback';
export * from './lib/toast/toast';
export * from './lib/overlay/modal';
export * from './lib/overlay/drawer';
export * from './lib/overlay/dropdown';
export * from './lib/page-header/page-header';
export * from './lib/stat-card/stat-card';
export * from './lib/table/table';
export * from './lib/charts/charts';

// Migration placeholder — delete when the last React screen is ported.
export * from './lib/coming-soon/coming-soon';
