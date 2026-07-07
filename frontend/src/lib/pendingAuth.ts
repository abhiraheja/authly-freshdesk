// Carries the verified-but-not-yet-consumed email token from the login /
// signup screen to onboarding step 2 (POST /api/signup consumes it there).
// sessionStorage survives the in-tab navigation; the magic-link tab carries
// its token in the URL instead.

export interface PendingAuth {
  email: string
  token?: string
  code?: string
}

const KEY = 'trackly.pendingAuth'

export function savePendingAuth(value: PendingAuth) {
  sessionStorage.setItem(KEY, JSON.stringify(value))
}

export function loadPendingAuth(): PendingAuth | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingAuth
  } catch {
    return null
  }
}

export function clearPendingAuth() {
  sessionStorage.removeItem(KEY)
}
