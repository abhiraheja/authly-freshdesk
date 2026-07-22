import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

// Rendered inside RequireAuth, so the user is always present here.
export function RequireRole({ roles }: { roles: string[] }) {
  const user = useAuthStore((s) => s.user)
  if (user && !roles.includes(user.role)) return <Navigate to="/portal" replace />
  return <Outlet />
}
