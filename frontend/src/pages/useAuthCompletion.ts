import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { homePathFor, type User } from '../api/auth'
import { useAuthStore } from '../store/auth'

// Shared tail of every successful sign-in: prime the caches and route by role.
export function useAuthCompletion() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)

  return (user: User) => {
    setUser(user)
    queryClient.setQueryData(['me'], user)
    navigate(homePathFor(user), { replace: true })
  }
}
