export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function initials(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback
  const parts = name.trim().split(/\s+/)
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = ['#F59E0B', '#10B981', '#8B5CF6', '#0EA5E9', '#EC4899', '#64748B', '#EA580C', '#4F46E5']

export function avatarColor(seed: string | null | undefined): string {
  const s = seed ?? ''
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Shared so a ticket state looks identical in every surface that renders it.
export const STATUS_CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  open: { bg: '#F0FDF4', fg: '#16A34A', label: 'Open' },
  pending: { bg: '#FFF7ED', fg: '#EA580C', label: 'Pending' },
  resolved: { bg: '#F1F5F9', fg: '#64748B', label: 'Resolved' },
  closed: { bg: '#F1F5F9', fg: '#64748B', label: 'Closed' },
}

export const PRIORITY_CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  low: { bg: '#F1F5F9', fg: '#64748B', label: 'Low' },
  medium: { bg: '#EEF2FF', fg: '#4F46E5', label: 'Medium' },
  high: { bg: '#FEF2F2', fg: '#DC2626', label: 'High' },
  urgent: { bg: '#DC2626', fg: '#FFFFFF', label: 'Urgent' },
}
