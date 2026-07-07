import { AppBar, Avatar, Box, Button, Stack, Toolbar, Typography } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { logout } from '../api/auth'
import { useAuthStore } from '../store/auth'

export function AppShell({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      setUser(null)
      queryClient.removeQueries({ queryKey: ['me'] })
      navigate('/login', { replace: true })
    },
  })

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: '#fff', borderBottom: '1px solid #E2E8F0' }}>
        <Toolbar>
          <Stack direction="row" spacing={1.1} sx={{ alignItems: 'center', flexGrow: 1 }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 14,
              }}
            >
              ◆
            </Box>
            <Typography sx={{ fontSize: 17, fontWeight: 800, color: 'text.primary' }}>Trackly</Typography>
            {user && (
              <Typography sx={{ fontSize: 14, color: 'text.secondary', pl: 1 }}>
                {user.workspace.name} · {user.workspace.slug}.trackly.com
              </Typography>
            )}
          </Stack>
          {user && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Avatar sx={{ width: 30, height: 30, bgcolor: 'secondary.main', fontSize: 14 }}>
                {(user.name ?? user.email ?? '?').charAt(0).toUpperCase()}
              </Avatar>
              <Typography sx={{ fontSize: 14, color: 'text.primary' }}>{user.name ?? user.email}</Typography>
              <Button size="small" color="inherit" sx={{ color: 'text.secondary' }} onClick={() => signOut.mutate()}>
                Sign out
              </Button>
            </Stack>
          )}
        </Toolbar>
      </AppBar>
      <Box sx={{ maxWidth: 960, mx: 'auto', px: 2, py: 4 }}>{children}</Box>
    </Box>
  )
}
