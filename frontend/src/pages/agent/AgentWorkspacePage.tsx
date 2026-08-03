import { Avatar, Box, Tooltip } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { logout } from '../../api/auth'
import { ColorModeToggle } from '../../components/ColorModeToggle'
import { initials } from '../../lib/format'
import { useAuthStore } from '../../store/auth'
import { ConversationPane } from './ConversationPane'
import { DetailsPane } from './DetailsPane'
import { TicketListPane } from './TicketListPane'

function RailIcon({ icon, title, active, onClick }: {
  icon: string
  title: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <Tooltip title={title} placement="right">
      <Box
        onClick={onClick}
        sx={{
          width: 42,
          height: 42,
          borderRadius: '11px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          color: active ? '#fff' : 'rgba(255,255,255,.6)',
          bgcolor: active ? 'rgba(255,255,255,.12)' : 'transparent',
          cursor: 'pointer',
          '&:hover': { color: '#fff' },
        }}
      >
        {icon}
      </Box>
    </Tooltip>
  )
}

// Three-pane agent workspace: rail | ticket list | conversation | details.
export function AgentWorkspacePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const queryClient = useQueryClient()

  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      setUser(null)
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '64px 1fr', lg: '64px 300px 1fr 300px' },
        height: '100vh',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      {/* Icon rail — always dark, it is chrome rather than content */}
      <Box
        sx={{
          bgcolor: '#18181B',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          py: 1.75,
          gap: 0.75,
        }}
      >
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #4F46E5, #A78BFA)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 800,
            mb: 1.75,
          }}
        >
          ◆
        </Box>
        <RailIcon icon="🏠" title="Dashboard" onClick={() => navigate('/dashboard')} />
        <RailIcon icon="🎫" title="Tickets" active />
        <Box sx={{ flex: 1 }} />
        <ColorModeToggle />
        <Tooltip title={`${user?.name ?? user?.email ?? ''} — sign out`} placement="right">
          <Avatar
            onClick={() => signOut.mutate()}
            sx={{
              width: 34,
              height: 34,
              bgcolor: 'secondary.main',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              mt: 1,
            }}
          >
            {initials(user?.name ?? user?.email)}
          </Avatar>
        </Tooltip>
      </Box>

      <TicketListPane selectedId={id} onSelect={(ticketId) => navigate(`/dashboard/tickets/${ticketId}`)} />

      {id ? (
        <>
          <ConversationPane ticketId={id} />
          <Box sx={{ display: { xs: 'none', lg: 'block' }, minHeight: 0 }}>
            <DetailsPane ticketId={id} />
          </Box>
        </>
      ) : (
        <Box
          sx={{
            display: { xs: 'none', lg: 'flex' },
            gridColumn: 'span 2',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
            gap: 1,
          }}
        >
          <Box sx={{ fontSize: 44 }}>🎫</Box>
          Select a ticket from the list
        </Box>
      )}
    </Box>
  )
}
