import { Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createChatConnection,
  endAgentChat,
  getAgentThread,
  listChatSessions,
  postAgentMessage,
  type ChatMessage,
  type ChatSession,
} from '../../api/chat'
import { AppShell } from '../../components/AppShell'
import { MessageList } from '../../components/chat/MessageList'
import { timeAgo } from '../../lib/format'
import { shadows } from '../../theme'

// Agent live-chat console. One hub connection watches the workspace lobby for
// new/ended sessions; selecting a session joins its group for real-time messages.
export function ChatConsolePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [visitorTyping, setVisitorTyping] = useState(false)
  const connRef = useRef<ReturnType<typeof createChatConnection> | null>(null)
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selected

  const addMessage = (m: ChatMessage) =>
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))

  // Single hub connection for the console lifetime.
  useEffect(() => {
    let active = true
    listChatSessions().then((s) => active && setSessions(s)).catch(() => {})

    const conn = createChatConnection()
    connRef.current = conn
    conn.on('session', (s: ChatSession) => {
      if (active) setSessions((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]))
    })
    conn.on('ended', (e: { sessionId: string }) => {
      if (!active) return
      setSessions((prev) => prev.filter((x) => x.id !== e.sessionId))
    })
    conn.on('message', (m: ChatMessage) => {
      if (active && m.sessionId === selectedRef.current) addMessage(m)
    })
    conn.on('typing', (sender: string, isTyping: boolean) => {
      if (active && sender === 'visitor') setVisitorTyping(isTyping)
    })
    conn.start().catch(() => {})
    return () => {
      active = false
      conn.stop().catch(() => {})
    }
  }, [])

  const open = async (id: string) => {
    setSelected(id)
    setVisitorTyping(false)
    const thread = await getAgentThread(id)
    setMessages(thread.messages)
    connRef.current?.invoke('JoinSession', id).catch(() => {})
  }

  const send = async () => {
    const body = draft.trim()
    if (!body || !selected) return
    setDraft('')
    connRef.current?.invoke('Typing', selected, 'agent', false).catch(() => {})
    const m = await postAgentMessage(selected, body)
    addMessage(m)
  }

  const end = async () => {
    if (!selected) return
    const r = await endAgentChat(selected)
    setSessions((prev) => prev.filter((x) => x.id !== selected))
    setSelected(null)
    setMessages([])
    queryClient.invalidateQueries({ queryKey: ['agent-tickets'] })
    navigate(`/dashboard/tickets/${r.ticketId}`)
  }

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 2 }}>Live chat</Typography>
      <Stack direction="row" spacing={2} sx={{ height: 'calc(100vh - 200px)' }}>
        {/* Active sessions */}
        <Paper variant="outlined" sx={{ width: 280, borderRadius: '14px', boxShadow: shadows.soft, overflowY: 'auto' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', p: 2, pb: 1 }}>
            ACTIVE ({sessions.length})
          </Typography>
          {sessions.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary', px: 2, pb: 2 }}>No active chats.</Typography>
          ) : (
            sessions.map((s) => (
              <Box
                key={s.id}
                onClick={() => open(s.id)}
                sx={{
                  px: 2,
                  py: 1.5,
                  cursor: 'pointer',
                  borderLeft: '3px solid',
                  borderColor: selected === s.id ? 'primary.main' : 'transparent',
                  bgcolor: selected === s.id ? 'action.selected' : 'transparent',
                }}
              >
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{s.visitorName ?? 'Visitor'}</Typography>
                  {!s.agentId && <Chip label="new" size="small" color="primary" sx={{ height: 18, fontSize: 10.5 }} />}
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>started {timeAgo(s.createdAt)} ago</Typography>
              </Box>
            ))
          )}
        </Paper>

        {/* Conversation */}
        <Paper variant="outlined" sx={{ flex: 1, borderRadius: '14px', boxShadow: shadows.soft, p: 2.5, display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
              Select a chat to respond.
            </Box>
          ) : (
            <>
              <MessageList messages={messages} viewer="agent" typingLabel={visitorTyping ? 'Visitor is typing…' : null} />
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Type a reply…"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    connRef.current?.invoke('Typing', selected, 'agent', e.target.value.length > 0).catch(() => {})
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                />
                <Button variant="contained" onClick={send}>Send</Button>
                <Button color="inherit" onClick={end}>End → ticket</Button>
              </Stack>
            </>
          )}
        </Paper>
      </Stack>
    </AppShell>
  )
}
