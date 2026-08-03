import {
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
  useColorScheme,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
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

  const [adminAnchor, setAdminAnchor] = useState<null | HTMLElement>(null)

  // Primary agent workspace links stay inline; the many admin surfaces live in a
  // single grouped "Admin" dropdown so the bar can't overflow as features grow.
  const primaryLinks = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Tickets', path: '/dashboard/tickets' },
    { label: 'Chat', path: '/dashboard/chat' },
    { label: 'Problems', path: '/dashboard/problems' },
    { label: 'Knowledge', path: '/dashboard/kb' },
    { label: 'Canned', path: '/dashboard/canned' },
  ]

  const adminGroups: { heading: string; items: { label: string; path: string }[] }[] = [
    {
      heading: 'Insights',
      items: [
        { label: 'Analytics', path: '/admin/analytics' },
        { label: 'Announcements', path: '/admin/announcements' },
      ],
    },
    {
      heading: 'People',
      items: [
        { label: 'Members', path: '/admin/users' },
        { label: 'Teams', path: '/admin/teams' },
      ],
    },
    {
      heading: 'Workflow',
      items: [
        { label: 'SLA policies', path: '/admin/settings/sla' },
        { label: 'Automation', path: '/admin/automation' },
        { label: 'AI copilot', path: '/admin/settings/ai' },
      ],
    },
    {
      heading: 'Channels',
      items: [
        { label: 'Messaging', path: '/admin/channels' },
        { label: 'Widget', path: '/admin/widget' },
        { label: 'Email', path: '/admin/settings/email' },
      ],
    },
    {
      heading: 'Workspace',
      items: [
        { label: 'Branding', path: '/admin/settings/branding' },
        { label: 'SSO', path: '/admin/settings/sso' },
        { label: 'Domains', path: '/admin/settings/domains' },
      ],
    },
  ]

  const isAdmin = user?.role === 'admin'
  const adminActive = location.pathname.startsWith('/admin')
  const goto = (path: string) => {
    setAdminAnchor(null)
    navigate(path)
  }

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
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ pl: 2, alignItems: 'center', overflow: 'hidden', flexShrink: 1, minWidth: 0 }}
              >
                {primaryLinks.map((link) => {
                  const active = location.pathname === link.path
                  return (
                    <Button
                      key={link.path}
                      size="small"
                      onClick={() => navigate(link.path)}
                      sx={{
                        fontSize: 13.5,
                        flexShrink: 0,
                        color: active ? 'primary.main' : 'text.secondary',
                        bgcolor: active ? 'action.selected' : 'transparent',
                      }}
                    >
                      {link.label}
                    </Button>
                  )
                })}

                {isAdmin && (
                  <>
                    <Button
                      size="small"
                      onClick={(e) => setAdminAnchor(e.currentTarget)}
                      sx={{
                        fontSize: 13.5,
                        flexShrink: 0,
                        color: adminActive ? 'primary.main' : 'text.secondary',
                        bgcolor: adminActive || adminAnchor ? 'action.selected' : 'transparent',
                      }}
                    >
                      Admin
                      <Box component="span" sx={{ fontSize: 10, ml: 0.5, opacity: 0.8 }}>▾</Box>
                    </Button>
                    <Menu
                      anchorEl={adminAnchor}
                      open={!!adminAnchor}
                      onClose={() => setAdminAnchor(null)}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                      slotProps={{ paper: { sx: { minWidth: 210, mt: 0.5 } } }}
                    >
                      {adminGroups.flatMap((group, gi) => [
                        gi > 0 ? <Divider key={`d-${group.heading}`} sx={{ my: 0.5 }} /> : null,
                        <ListSubheader
                          key={`h-${group.heading}`}
                          disableSticky
                          sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', lineHeight: 2.2, bgcolor: 'transparent' }}
                        >
                          {group.heading}
                        </ListSubheader>,
                        ...group.items.map((item) => (
                          <MenuItem
                            key={item.path}
                            selected={location.pathname === item.path}
                            onClick={() => goto(item.path)}
                            sx={{ fontSize: 13.5, py: 0.75 }}
                          >
                            {item.label}
                          </MenuItem>
                        )),
                      ])}
                    </Menu>
                  </>
                )}
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
