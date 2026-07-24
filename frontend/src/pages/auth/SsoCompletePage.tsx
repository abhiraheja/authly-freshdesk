import { Box, CircularProgress } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMe, homePathFor } from '../../api/auth'
import { useAuthStore } from '../../store/auth'

// The SSO callback set the session cookie and redirected here. Load the profile,
// prime the store, and route by role — or bounce to login if the cookie didn't
// take.
export function SsoCompletePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)

  useEffect(() => {
    let active = true
    getMe()
      .then((user) => {
        if (!active) return
        setUser(user)
        queryClient.setQueryData(['me'], user)
        navigate(homePathFor(user), { replace: true })
      })
      .catch(() => {
        if (active) navigate('/login?sso_error=Sign-in%20did%20not%20complete.', { replace: true })
      })
    return () => {
      active = false
    }
  }, [navigate, queryClient, setUser])

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress />
    </Box>
  )
}
