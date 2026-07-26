import { AppBar, Avatar, Box, Button, Stack, Toolbar, Typography, useColorScheme } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { logout } from '../api/auth'
import { getPublicBranding } from '../api/guest'
import { initials } from '../lib/format'
import { useAuthStore } from '../store/auth'
import { glass } from '../theme'
import { ColorModeToggle } from './ColorModeToggle'

// Trackly-owned chrome: glass app bar, role-aware nav, colour-mode toggle.
// For CUSTOMERS the header switches to the workspace's branding instead —
// invariant 6: customer-facing surfaces never show Trackly's brand.
export function AppShell({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { mode, systemMode } = useColorScheme()
  const resolvedMode = mode === 'system' ? systemMode : mode

  const isAgent = user?.role === 'agent' || user?.role === 'admin'
  const isCustomer = user?.role === 'customer'

  const { data: branding } = useQuery({
    queryKey: ['branding', user?.workspace.slug],
    queryFn: () => getPublicBranding(user!.workspace.slug),
    enabled: !!user && isCustomer,
    staleTime: 60_000,
  })
  const brandColor = isCustomer ? branding?.primaryColor : undefined

  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      setUser(null)
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  const links = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Tickets', path: '/dashboard/tickets' },
    { label: 'Problems', path: '/dashboard/problems' },
    { label: 'Announcements', path: '/admin/announcements', adminOnly: true },
    { label: 'Members', path: '/admin/users', adminOnly: true },
    { label: 'Teams', path: '/admin/teams', adminOnly: true },
    { label: 'SLA', path: '/admin/settings/sla', adminOnly: true },
    { label: 'Branding', path: '/admin/settings/branding', adminOnly: true },
    { label: 'Email', path: '/admin/settings/email', adminOnly: true },
    { label: 'SSO', path: '/admin/settings/sso', adminOnly: true },
    { label: 'Domains', path: '/admin/settings/domains', adminOnly: true },
    { label: 'Widget', path: '/admin/widget', adminOnly: true },
  ].filter((l) => !l.adminOnly || user?.role === 'admin')

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: isCustomer ? '#F6F4FA' : 'background.default' }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={
          brandColor
            ? { bgcolor: brandColor }
            : {
                ...(resolvedMode === 'dark' ? glass.dark : glass.light),
                borderBottom: '1px solid',
                borderColor: 'divider',
                color: 'text.primary',
              }
        }
      >
        <Toolbar>
          <Stack direction="row" spacing={1.1} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
            {isCustomer && branding ? (
              <>
                {branding.logoUrl ? (
                  <Avatar src={branding.logoUrl} variant="rounded" sx={{ width: 30, height: 30, bgcolor: '#fff' }} />
                ) : (
                  <Avatar
                    variant="rounded"
                    sx={{ width: 30, height: 30, bgcolor: '#fff', color: brandColor, fontWeight: 800, fontSize: 14 }}
                  >
                    {branding.workspaceName.charAt(0).toUpperCase()}
                  </Avatar>
                )}
                <Typography sx={{ fontSize: 16.5, fontWeight: 700, color: '#fff' }}>
                  {branding.pageTitle}
                </Typography>
              </>
            ) : (
              <>
                <Box
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #4F46E5, #A78BFA)',
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
                  <Typography sx={{ fontSize: 14, color: 'text.secondary', pl: 1 }} noWrap>
                    {user.workspace.name}
                  </Typography>
                )}
              </>
            )}
            {user && isAgent && (
              <Stack direction="row" spacing={0.5} sx={{ pl: 2 }}>
                {links.map((link) => {
                  const active = location.pathname === link.path
                  return (
                    <Button
                      key={link.path}
                      size="small"
                      onClick={() => navigate(link.path)}
                      sx={{
                        fontSize: 13.5,
                        color: active ? 'primary.main' : 'text.secondary',
                        bgcolor: active ? 'action.selected' : 'transparent',
                      }}
                    >
                      {link.label}
                    </Button>
                  )
                })}
              </Stack>
            )}
          </Stack>

          {user && (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              {/* Dark mode is a Trackly-surface affordance only */}
              {!isCustomer && <ColorModeToggle />}
              <Avatar
                sx={{
                  width: 30,
                  height: 30,
                  bgcolor: brandColor ? 'rgba(255,255,255,.25)' : 'secondary.main',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {initials(user.name ?? user.email)}
              </Avatar>
              <Typography
                sx={{ fontSize: 14, color: brandColor ? '#fff' : 'text.primary', display: { xs: 'none', sm: 'block' } }}
              >
                {user.name ?? user.email}
              </Typography>
              <Button
                size="small"
                sx={{ color: brandColor ? 'rgba(255,255,255,.85)' : 'text.secondary' }}
                onClick={() => signOut.mutate()}
              >
                Sign out
              </Button>
            </Stack>
          )}
        </Toolbar>
      </AppBar>

      <Box sx={{ maxWidth: 1280, mx: 'auto', px: 2, py: 4 }}>{children}</Box>
    </Box>
  )
}
