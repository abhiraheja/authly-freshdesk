import { Card, CardContent, Typography } from '@mui/material'
import { AppShell } from '../components/AppShell'
import { useAuthStore } from '../store/auth'

export function PortalPage() {
  const user = useAuthStore((s) => s.user)

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        {user?.workspace.name} Support
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Your support tickets will appear here.
      </Typography>
      <Card variant="outlined" sx={{ maxWidth: 520, borderRadius: '18px' }}>
        <CardContent sx={{ p: 3, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 40, mb: 1 }}>🎫</Typography>
          <Typography sx={{ fontWeight: 700 }}>No tickets yet</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14.5 }}>
            Ticket submission arrives in Phase 2.
          </Typography>
        </CardContent>
      </Card>
    </AppShell>
  )
}
