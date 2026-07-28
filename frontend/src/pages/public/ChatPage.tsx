import { Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createChatConnection,
  endVisitorChat,
  getVisitorThread,
  postVisitorMessage,
  startChat,
  type ChatMessage,
} from '../../api/chat'
import { getPublicBranding } from '../../api/guest'
import { BrandedCard, BrandedFrame } from '../../components/BrandedFrame'
import { MessageList } from '../../components/chat/MessageList'

// Public, workspace-branded live chat (/chat?workspace=slug). Always light,
// workspace brand (invariant 6). REST-backed with SignalR for live delivery.
export function ChatPage() {
  const [params] = useSearchParams()
  const slug = params.get('workspace') ?? ''

  const brandingQuery = useQuery({
    queryKey: ['branding', slug],
    queryFn: () => getPublicBranding(slug),
    enabled: !!slug,
    retry: false,
  })

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [session, setSession] = useState<{ id: string; token: string } | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [agentTyping, setAgentTyping] = useState(false)
  const [ended, setEnded] = useState<{ ticketId: string } | null>(null)
  const [starting, setStarting] = useState(false)
  const connRef = useRef<ReturnType<typeof createChatConnection> | null>(null)

  const addMessage = (m: ChatMessage) =>
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))

  // Wire the hub once a session exists.
  useEffect(() => {
    if (!session) return
    let active = true
    const conn = createChatConnection({ sessionId: session.id, visitorToken: session.token })
    connRef.current = conn
    conn.on('message', (m: ChatMessage) => active && addMessage(m))
    conn.on('typing', (sender: string, isTyping: boolean) => {
      if (active && sender === 'agent') setAgentTyping(isTyping)
    })
    conn.on('ended', (e: { ticketId: string }) => active && setEnded({ ticketId: e.ticketId }))
    conn.start().catch(() => {})
    getVisitorThread(session.id, session.token)
      .then((t) => active && setMessages(t.messages))
      .catch(() => {})
    return () => {
      active = false
      conn.stop().catch(() => {})
    }
  }, [session])

  if (brandingQuery.isPending) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }
  const branding = brandingQuery.data
  if (!branding) {
    return <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>Chat is not available.</Box>
  }

  const start = async () => {
    setStarting(true)
    try {
      const s = await startChat(slug, name, email)
      setSession({ id: s.sessionId, token: s.token })
    } finally {
      setStarting(false)
    }
  }

  const send = async () => {
    const body = draft.trim()
    if (!body || !session) return
    setDraft('')
    connRef.current?.invoke('Typing', session.id, 'visitor', false).catch(() => {})
    const m = await postVisitorMessage(session.id, session.token, body)
    addMessage(m)
  }

  const end = async () => {
    if (!session) return
    const r = await endVisitorChat(session.id, session.token)
    setEnded({ ticketId: r.ticketId })
  }

  return (
    <BrandedFrame branding={branding}>
      <BrandedCard>
        {!session ? (
          <Stack spacing={2}>
            <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#1E1B2E' }}>Chat with us</Typography>
            <Typography sx={{ fontSize: 14, color: '#6B7280' }}>
              Start a live conversation. Tell us who you are (optional) so we can follow up.
            </Typography>
            <TextField size="small" label="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField size="small" label="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button
              variant="contained"
              disabled={starting}
              onClick={start}
              sx={{ bgcolor: branding.primaryColor, '&:hover': { bgcolor: branding.primaryColor, filter: 'brightness(0.92)' } }}
            >
              {starting ? 'Starting…' : 'Start chat'}
            </Button>
          </Stack>
        ) : ended ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#1E1B2E', mb: 1 }}>Chat ended</Typography>
            <Typography sx={{ fontSize: 14, color: '#6B7280' }}>
              Thanks for chatting. We've saved this conversation as a ticket and will follow up if needed.
            </Typography>
          </Box>
        ) : (
          <Stack sx={{ height: 460 }}>
            <MessageList messages={messages} viewer="visitor" typingLabel={agentTyping ? 'Agent is typing…' : null} />
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Type a message…"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  connRef.current?.invoke('Typing', session.id, 'visitor', e.target.value.length > 0).catch(() => {})
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
              />
              <Button variant="contained" onClick={send} sx={{ bgcolor: branding.primaryColor }}>
                Send
              </Button>
            </Stack>
            <Button size="small" onClick={end} sx={{ mt: 1, alignSelf: 'flex-end', color: '#6B7280' }}>
              End chat
            </Button>
          </Stack>
        )}
      </BrandedCard>
    </BrandedFrame>
  )
}
