import { CircularProgress, Box } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { getMe } from '../api/auth'
import { useAuthStore } from '../store/auth'

export function RequireAuth() {
  const setUser = useAuthStore((s) => s.setUser)
  const { data: user, isPending, isError } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    retry: false,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (user) setUser(user)
  }, [user, setUser])

  if (isPending) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }
  if (isError || !user) return <Navigate to="/login" replace />
  return <Outlet />
}
