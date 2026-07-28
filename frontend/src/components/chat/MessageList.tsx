import { Box, Stack, Typography } from '@mui/material'
import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../api/chat'
import { formatDateTime } from '../../lib/format'

// Shared chat transcript view for both the visitor and agent surfaces. "mine"
// bubbles align right; the counterpart aligns left; system lines are centered.
export function MessageList({
  messages,
  viewer,
  typingLabel,
}: {
  messages: ChatMessage[]
  viewer: 'visitor' | 'agent'
  typingLabel?: string | null
}) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, typingLabel])

  return (
    <Box sx={{ flex: 1, overflowY: 'auto', pr: 0.5 }}>
      <Stack spacing={1.25}>
        {messages.map((m) => {
          if (m.sender === 'system') {
            return (
              <Typography key={m.id} sx={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', py: 0.5 }}>
                {m.body}
              </Typography>
            )
          }
          const mine = m.sender === viewer
          return (
            <Box key={m.id} sx={{ maxWidth: '78%', alignSelf: mine ? 'flex-end' : 'flex-start' }}>
              <Typography sx={{ fontSize: 11, color: '#9CA3AF', mb: 0.25, textAlign: mine ? 'right' : 'left' }}>
                {m.sender === 'agent' ? m.authorName ?? 'Agent' : 'You'} · {formatDateTime(m.createdAt)}
              </Typography>
              <Box
                sx={{
                  px: 1.6,
                  py: 1,
                  borderRadius: '12px',
                  fontSize: 14,
                  whiteSpace: 'pre-wrap',
                  bgcolor: mine ? 'primary.main' : 'action.hover',
                  color: mine ? '#fff' : 'text.primary',
                  borderTopRightRadius: mine ? '4px' : '12px',
                  borderTopLeftRadius: mine ? '12px' : '4px',
                }}
              >
                {m.body}
              </Box>
            </Box>
          )
        })}
        {typingLabel && (
          <Typography sx={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>{typingLabel}</Typography>
        )}
      </Stack>
      <div ref={endRef} />
    </Box>
  )
}
