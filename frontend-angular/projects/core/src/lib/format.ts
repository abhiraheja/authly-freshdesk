/**
 * Formatting + the semantic tone map.
 *
 * The tone map is the reason a ticket state looks identical in the table, the
 * detail rail, the portal and the dashboard: nothing picks a colour by eye, it
 * looks the state up here and renders `<tk-badge [tone]="…">`.
 */

/** Every coloured state in the product resolves to one of these six. */
export type Tone = 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface ToneLabel {
  tone: Tone;
  label: string;
}

export const STATUS_TONE: Record<string, ToneLabel> = {
  open: { tone: 'info', label: 'Open' },
  pending: { tone: 'warning', label: 'Pending' },
  resolved: { tone: 'success', label: 'Resolved' },
  closed: { tone: 'neutral', label: 'Closed' },
};

export const PRIORITY_TONE: Record<string, ToneLabel> = {
  low: { tone: 'neutral', label: 'Low' },
  medium: { tone: 'info', label: 'Medium' },
  high: { tone: 'warning', label: 'High' },
  urgent: { tone: 'danger', label: 'Urgent' },
};

export const ROLE_TONE: Record<string, ToneLabel> = {
  admin: { tone: 'primary', label: 'Admin' },
  agent: { tone: 'info', label: 'Agent' },
  customer: { tone: 'neutral', label: 'Customer' },
};

/** Falls back to a neutral chip with the raw value rather than rendering nothing. */
export function toneFor(map: Record<string, ToneLabel>, key: string | null | undefined): ToneLabel {
  if (!key) return { tone: 'neutral', label: '—' };
  return map[key] ?? { tone: 'neutral', label: key };
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** Compact relative age: `12s`, `4m`, `3h`, `2d`. Clamped at zero. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `4h 12m` — for durations shown as a KPI value, where units carry the meaning. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = Math.round(minutes % 60);
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// ── People ──────────────────────────────────────────────────────────────────

export function initials(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return fallback;
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Deterministic avatar colour.
 *
 * Deliberately identical in light and dark: an avatar's colour is part of how a
 * person is recognised at a glance, so it must not shift with the theme. All
 * eight pass contrast against white text.
 */
const AVATAR_COLORS = [
  '#F59E0B',
  '#10B981',
  '#8B5CF6',
  '#0EA5E9',
  '#EC4899',
  '#64748B',
  '#EA580C',
  '#4F46E5',
] as const;

export function avatarColor(seed: string | null | undefined): string {
  const value = seed ?? '';
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── Files ───────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
