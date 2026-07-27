import { Alert, Box, Button, Divider, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  getEmailConfig,
  getNotificationSettings,
  saveEmailConfig,
  saveNotificationSettings,
  type EmailConfig,
  type NotificationSettings,
} from '../../api/email'
import { AppShell } from '../../components/AppShell'
import { useAuthStore } from '../../store/auth'
import { shadows } from '../../theme'

const label = { fontSize: 13.5, fontWeight: 600, color: 'text.primary', mb: 0.75, mt: 2.5 }

export function EmailSettingsPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const origin = window.location.origin
  const slug = user?.workspace.slug ?? ''

  const [cfg, setCfg] = useState<EmailConfig | null>(null)
  const [smtpPassword, setSmtpPassword] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [mailboxPassword, setMailboxPassword] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const emailQuery = useQuery({ queryKey: ['email-config'], queryFn: getEmailConfig })
  const notifQuery = useQuery({ queryKey: ['notification-settings'], queryFn: getNotificationSettings })
  const [notif, setNotif] = useState<NotificationSettings | null>(null)

  useEffect(() => { if (emailQuery.data) setCfg(emailQuery.data) }, [emailQuery.data])
  useEffect(() => { if (notifQuery.data) setNotif(notifQuery.data) }, [notifQuery.data])

  const set = <K extends keyof EmailConfig>(key: K, value: EmailConfig[K]) =>
    setCfg((c) => (c ? { ...c, [key]: value } : c))

  const saveEmail = useMutation({
    mutationFn: () => {
      if (!cfg) throw new Error('Not loaded')
      return saveEmailConfig({
        useSharedSmtp: cfg.useSharedSmtp,
        smtpHost: cfg.smtpHost,
        smtpPort: cfg.smtpPort,
        smtpUser: cfg.smtpUser,
        smtpUseStartTls: cfg.smtpUseStartTls,
        fromName: cfg.fromName,
        fromEmail: cfg.fromEmail,
        smtpPassword: smtpPassword || null,
        emailMode: cfg.emailMode,
        newTicketViaEmail: cfg.newTicketViaEmail,
        inboundConnector: cfg.inboundConnector,
        inboundProvider: cfg.inboundProvider,
        inboundReplyDomain: cfg.inboundReplyDomain,
        inboundWebhookSecret: webhookSecret || null,
        mailboxProtocol: cfg.mailboxProtocol,
        mailboxAddress: cfg.mailboxAddress,
        mailboxHost: cfg.mailboxHost,
        mailboxPort: cfg.mailboxPort,
        mailboxUsername: cfg.mailboxUsername,
        mailboxPassword: mailboxPassword || null,
        pollIntervalSeconds: cfg.pollIntervalSeconds,
      })
    },
    onSuccess: (saved) => {
      setCfg(saved)
      setSmtpPassword('')
      setWebhookSecret('')
      setMailboxPassword('')
      setMessage({ kind: 'success', text: 'Email settings saved.' })
      queryClient.invalidateQueries({ queryKey: ['email-config'] })
    },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  })

  const saveNotif = useMutation({
    mutationFn: () => saveNotificationSettings(notif!),
    onSuccess: () => setMessage({ kind: 'success', text: 'Notification preferences saved.' }),
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  })

  if (!cfg) {
    return (
      <AppShell>
        <Typography color="text.secondary">Loading email settings…</Typography>
      </AppShell>
    )
  }

  const connector = cfg.inboundConnector ?? 'none'

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Email</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        How Trackly sends notifications and receives replies for this workspace. Secrets are encrypted at rest and never
        shown back.
      </Typography>

      <Box sx={{ maxWidth: 720 }}>
        {/* Outbound */}
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, mb: 3, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Outbound (SMTP)</Typography>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 1.5 }}>
            <Typography sx={{ fontSize: 14 }}>Use the shared Trackly relay</Typography>
            <Switch checked={cfg.useSharedSmtp} onChange={(e) => set('useSharedSmtp', e.target.checked)} />
          </Stack>

          {!cfg.useSharedSmtp && (
            <>
              <Typography sx={label}>SMTP host</Typography>
              <TextField fullWidth size="small" value={cfg.smtpHost ?? ''} onChange={(e) => set('smtpHost', e.target.value)} />
              <Stack direction="row" spacing={2}>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={label}>Port</Typography>
                  <TextField fullWidth size="small" type="number" value={cfg.smtpPort ?? ''}
                    onChange={(e) => set('smtpPort', e.target.value ? Number(e.target.value) : null)} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={label}>Username</Typography>
                  <TextField fullWidth size="small" value={cfg.smtpUser ?? ''} onChange={(e) => set('smtpUser', e.target.value)} />
                </Box>
              </Stack>
              <Typography sx={label}>Password {cfg.hasSmtpPassword && '(saved — leave blank to keep)'}</Typography>
              <TextField fullWidth size="small" type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} />
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
                <Typography sx={{ fontSize: 14 }}>Use STARTTLS</Typography>
                <Switch checked={cfg.smtpUseStartTls} onChange={(e) => set('smtpUseStartTls', e.target.checked)} />
              </Stack>
            </>
          )}

          <Stack direction="row" spacing={2}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={label}>From name</Typography>
              <TextField fullWidth size="small" placeholder={user?.workspace.name} value={cfg.fromName ?? ''}
                onChange={(e) => set('fromName', e.target.value)} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={label}>From email</Typography>
              <TextField fullWidth size="small" placeholder="support@acme.com" value={cfg.fromEmail ?? ''}
                onChange={(e) => set('fromEmail', e.target.value)} />
            </Box>
          </Stack>
        </Paper>

        {/* Interaction mode + inbound */}
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, mb: 3, boxShadow: shadows.soft }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Replies & inbound</Typography>

          <Typography sx={label}>Interaction mode</Typography>
          <TextField select fullWidth size="small" value={cfg.emailMode} onChange={(e) => set('emailMode', e.target.value)}>
            <MenuItem value="notifications_only">Notifications only — replies go nowhere</MenuItem>
            <MenuItem value="one_way">One-way — customers can reply by email</MenuItem>
            <MenuItem value="two_way">Two-way — both sides reply by email</MenuItem>
          </TextField>

          <Typography sx={label}>Inbound connector</Typography>
          <TextField select fullWidth size="small" value={connector}
            onChange={(e) => set('inboundConnector', e.target.value === 'none' ? null : e.target.value)}>
            <MenuItem value="none">None</MenuItem>
            <MenuItem value="parse_webhook">Parse webhook (MX + provider)</MenuItem>
            <MenuItem value="mailbox_poll">Mailbox polling (IMAP)</MenuItem>
          </TextField>

          {connector === 'parse_webhook' && (
            <>
              <Typography sx={label}>Provider</Typography>
              <TextField select fullWidth size="small" value={cfg.inboundProvider ?? 'sendgrid'}
                onChange={(e) => set('inboundProvider', e.target.value)}>
                <MenuItem value="sendgrid">SendGrid</MenuItem>
                <MenuItem value="mailgun">Mailgun</MenuItem>
                <MenuItem value="postmark">Postmark</MenuItem>
                <MenuItem value="ses">Amazon SES</MenuItem>
              </TextField>
              <Typography sx={label}>Reply domain</Typography>
              <TextField fullWidth size="small" placeholder="tickets.acme.com" value={cfg.inboundReplyDomain ?? ''}
                onChange={(e) => set('inboundReplyDomain', e.target.value)} />
              <Typography sx={label}>Webhook signing secret {cfg.hasInboundWebhookSecret && '(saved — leave blank to keep)'}</Typography>
              <TextField fullWidth size="small" type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
              <Alert severity="info" sx={{ mt: 1.5, fontSize: 13 }}>
                Point your provider's inbound parse at <b>{`${origin}/api/email/inbound/${slug}`}</b> and sign the raw
                body as <b>X-Trackly-Signature</b> (hex HMAC-SHA256).
              </Alert>
            </>
          )}

          {connector === 'mailbox_poll' && (
            <>
              <Typography sx={label}>Protocol</Typography>
              <TextField select fullWidth size="small" value={cfg.mailboxProtocol ?? 'imap'}
                onChange={(e) => set('mailboxProtocol', e.target.value)}>
                <MenuItem value="imap">IMAP</MenuItem>
              </TextField>
              <Typography sx={label}>Mailbox address</Typography>
              <TextField fullWidth size="small" placeholder="support@acme.com" value={cfg.mailboxAddress ?? ''}
                onChange={(e) => set('mailboxAddress', e.target.value)} />
              <Stack direction="row" spacing={2}>
                <Box sx={{ flex: 2 }}>
                  <Typography sx={label}>IMAP host</Typography>
                  <TextField fullWidth size="small" placeholder="imap.gmail.com" value={cfg.mailboxHost ?? ''}
                    onChange={(e) => set('mailboxHost', e.target.value)} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={label}>Port</Typography>
                  <TextField fullWidth size="small" type="number" value={cfg.mailboxPort ?? ''}
                    onChange={(e) => set('mailboxPort', e.target.value ? Number(e.target.value) : null)} />
                </Box>
              </Stack>
              <Typography sx={label}>Username</Typography>
              <TextField fullWidth size="small" value={cfg.mailboxUsername ?? ''} onChange={(e) => set('mailboxUsername', e.target.value)} />
              <Typography sx={label}>App password {cfg.hasMailboxPassword && '(saved — leave blank to keep)'}</Typography>
              <TextField fullWidth size="small" type="password" value={mailboxPassword} onChange={(e) => setMailboxPassword(e.target.value)} />
              <Typography sx={label}>Poll interval (seconds)</Typography>
              <TextField fullWidth size="small" type="number" value={cfg.pollIntervalSeconds}
                onChange={(e) => set('pollIntervalSeconds', Number(e.target.value) || 60)} />
            </>
          )}

          <Divider sx={{ my: 2.5 }} />
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ fontSize: 14 }}>Create tickets from new emails</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                A cold email with no matching ticket opens a new one.
              </Typography>
            </Box>
            <Switch checked={cfg.newTicketViaEmail} onChange={(e) => set('newTicketViaEmail', e.target.checked)} />
          </Stack>
        </Paper>

        {message && <Alert severity={message.kind} sx={{ mb: 2 }}>{message.text}</Alert>}
        <Button variant="contained" size="large" disabled={saveEmail.isPending} onClick={() => saveEmail.mutate()}>
          Save email settings
        </Button>

        {/* Notifications */}
        {notif && (
          <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, mt: 4, boxShadow: shadows.soft }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1 }}>Notifications</Typography>
            {([
              ['notifyCustomerOnCreate', 'Email the customer when their ticket is created'],
              ['notifyCustomerOnReply', 'Email the customer when an agent replies'],
              ['notifyCustomerOnStatus', 'Email the customer when the status changes'],
              ['notifyAgentOnAssign', 'Email the agent when a ticket is assigned to them'],
              ['notifyAgentOnReply', 'Email the agent when the customer replies'],
              ['notifyAgentOnReassign', 'Email the agent when a ticket is reassigned'],
              ['csatEnabled', 'Include a satisfaction survey link in the resolution email'],
            ] as [keyof NotificationSettings, string][]).map(([key, text]) => (
              <Stack key={key} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
                <Typography sx={{ fontSize: 14 }}>{text}</Typography>
                <Switch checked={notif[key]} onChange={(e) => setNotif({ ...notif, [key]: e.target.checked })} />
              </Stack>
            ))}
            <Button variant="contained" sx={{ mt: 2 }} disabled={saveNotif.isPending} onClick={() => saveNotif.mutate()}>
              Save notifications
            </Button>
          </Paper>
        )}
      </Box>
    </AppShell>
  )
}
