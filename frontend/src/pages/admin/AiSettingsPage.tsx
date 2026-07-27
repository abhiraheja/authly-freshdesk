import { Alert, Box, Paper, Stack, Switch, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAiSettings, setAiEnabled } from '../../api/ai'
import { AppShell } from '../../components/AppShell'
import { shadows } from '../../theme'

export function AiSettingsPage() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ['ai-settings'], queryFn: getAiSettings })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setAiEnabled(enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-settings'] }),
  })

  const settings = settingsQuery.data

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>AI copilot</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Claude-powered assists for your agents — draft replies, summarize threads, and suggest triage. Suggestions are
        always agent-reviewed; nothing is ever sent to a customer automatically, and private notes are never shared with
        the model.
      </Typography>

      <Box sx={{ maxWidth: 560 }}>
        {settings && !settings.configured && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            No AI provider key is configured for this deployment. AI features stay off until an admin sets{' '}
            <b>Ai:ApiKey</b> on the server.
          </Alert>
        )}
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, boxShadow: shadows.soft }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Enable AI copilot for this workspace</Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
                Turns the ✨ AI actions on in the agent workspace. Turn off to disable AI entirely for your team.
              </Typography>
            </Box>
            <Switch
              checked={settings?.enabled ?? false}
              disabled={!settings || toggle.isPending}
              onChange={(e) => toggle.mutate(e.target.checked)}
            />
          </Stack>
          {settings?.enabled && settings.configured && (
            <Alert severity="success" sx={{ mt: 2 }}>AI copilot is active. Agents will see ✨ actions on tickets.</Alert>
          )}
        </Paper>
      </Box>
    </AppShell>
  )
}
