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
export * from './lib/icon/provider-mark';
export * from './lib/button/button';
export * from './lib/card/card';
export * from './lib/badge/badge';
export * from './lib/avatar/avatar';
export * from './lib/forms/input';
export * from './lib/forms/field';
export * from './lib/forms/combobox';
export * from './lib/forms/select';
export * from './lib/forms/toggle';
export * from './lib/forms/radio';
export * from './lib/forms/tag-input';
export * from './lib/editor/editor';
export * from './lib/editor/rich-text';
export * from './lib/editor/rich-text-view';
export * from './lib/upload/file-picker';
export * from './lib/upload/avatar-upload';
export * from './lib/upload/attachment-list';
export * from './lib/feedback/feedback';
export * from './lib/toast/toast';
export * from './lib/overlay/modal';
export * from './lib/overlay/confirm';
export * from './lib/overlay/drawer';
export * from './lib/overlay/dropdown';
export * from './lib/page-header/page-header';
export * from './lib/stat-card/stat-card';
export * from './lib/table/table';
export * from './lib/tabs/tabs';
export * from './lib/charts/charts';

// Migration placeholder — delete when the last React screen is ported.
export * from './lib/coming-soon/coming-soon';
