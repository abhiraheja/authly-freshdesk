import { Box, Card, CardContent, List, ListItem, Typography } from '@mui/material'
import { AppShell } from '../components/AppShell'
import { useAuthStore } from '../store/auth'

const checklist = [
  { label: 'Create your workspace', done: true },
  { label: 'Add your branding', done: false, phase: 'Phase 3' },
  { label: 'Invite agents', done: false, phase: 'Phase 3' },
  { label: 'Verify your email domain', done: false, phase: 'Phase 5' },
  { label: 'Configure SSO', done: false, phase: 'Phase 5' },
]

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Your workspace is ready. Ticketing lands in Phase 2 — here's what's next.
      </Typography>
      <Card variant="outlined" sx={{ maxWidth: 520, borderRadius: '18px' }}>
        <CardContent sx={{ p: 3 }}>
          <Typography sx={{ fontSize: 19, fontWeight: 700, mb: 0.5 }}>🚀 Getting started</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 14.5, mb: 1.5 }}>
            1 of 5 complete
          </Typography>
          <List disablePadding>
            {checklist.map((item) => (
              <ListItem
                key={item.label}
                sx={{
                  border: '1px solid #E2E8F0',
                  borderRadius: '10px',
                  mb: 1,
                  fontSize: 14.5,
                  color: item.done ? '#94A3B8' : '#334155',
                  textDecoration: item.done ? 'line-through' : 'none',
                  bgcolor: item.done ? '#F8FAFC' : '#fff',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  {item.done ? '✅' : '⬜'}&nbsp;&nbsp;{item.label}
                </span>
                {!item.done && item.phase && (
                  <Box component="span" sx={{ fontSize: 12, color: '#94A3B8' }}>
                    {item.phase}
                  </Box>
                )}
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>
    </AppShell>
  )
}
