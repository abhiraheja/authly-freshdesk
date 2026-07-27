import { Alert, Box, Button, Chip, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { listChannels, saveChannel, type ChannelConnector } from '../../api/channels'
import { AppShell } from '../../components/AppShell'
import { useAuthStore } from '../../store/auth'
import { shadows } from '../../theme'

const PROVIDERS: Record<string, { name: string; hint: string }> = {
  slack: { name: 'Slack', hint: 'Messages from a Slack channel or thread become tickets.' },
  whatsapp: { name: 'WhatsApp', hint: 'WhatsApp Cloud API conversations become tickets, threaded per phone number.' },
  teams: { name: 'Microsoft Teams', hint: 'Teams conversations become tickets via the Bot Framework relay.' },
}

function ConnectorCard({ connector, slug }: { connector: ChannelConnector; slug: string }) {
  const queryClient = useQueryClient()
  const meta = PROVIDERS[connector.provider] ?? { name: connector.provider, hint: '' }
  const [enabled, setEnabled] = useState(connector.enabled)
  const [secret, setSecret] = useState('')
  const webhookUrl = `${window.location.origin}/api/channels/inbound/${connector.provider}/${slug}`

  const save = useMutation({
    mutationFn: () => saveChannel(connector.provider, { enabled, secret: secret.trim() || null }),
    onSuccess: () => {
      setSecret('')
      queryClient.invalidateQueries({ queryKey: ['channels'] })
    },
  })

  return (
    <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, boxShadow: shadows.soft }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{meta.name}</Typography>
          {connector.hasSecret ? (
            <Chip size="small" color="success" variant="outlined" label="secret set" />
          ) : (
            <Chip size="small" variant="outlined" label="no secret" />
          )}
        </Stack>
        <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>{meta.hint}</Typography>

      {enabled && !connector.hasSecret && !secret.trim() && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Set a signing secret — inbound messages are rejected until the relay can sign requests with it.
        </Alert>
      )}

      <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>Webhook URL</Typography>
      <Box
        sx={{
          fontFamily: 'monospace',
          fontSize: 12.5,
          bgcolor: 'action.hover',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '8px',
          p: 1.25,
          mb: 2,
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        {webhookUrl}
      </Box>

      <TextField
        fullWidth
        size="small"
        type="password"
        label={connector.hasSecret ? 'Rotate signing secret (leave blank to keep)' : 'Signing secret'}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        sx={{ mb: 2 }}
      />
      <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
    </Paper>
  )
}

export function ChannelsPage() {
  const slug = useAuthStore((s) => s.user?.workspace.slug) ?? ''
  const query = useQuery({ queryKey: ['channels'], queryFn: listChannels })

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Channels</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Connect Slack, WhatsApp, and Microsoft Teams. A provider-native relay normalizes each provider's payload and
        signs it with the connector's secret (HMAC-SHA256, <b>X-Trackly-Signature</b>); Trackly threads messages from the
        same conversation into one ticket.
      </Typography>

      <Box sx={{ maxWidth: 620 }}>
        <Stack spacing={2.5}>
          {(query.data ?? []).map((c) => (
            <ConnectorCard key={c.provider} connector={c} slug={slug} />
          ))}
        </Stack>
      </Box>
    </AppShell>
  )
}
