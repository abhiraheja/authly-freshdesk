import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { deleteSso, getSso, saveSso, type GroupMapping, type SaveSsoBody } from '../../api/sso'
import { AppShell } from '../../components/AppShell'
import { useAuthStore } from '../../store/auth'
import { shadows } from '../../theme'

type Protocol = 'oidc' | 'saml'

const PRESETS: { label: string; providerName: string; protocol: Protocol }[] = [
  { label: 'Authly', providerName: 'Authly', protocol: 'oidc' },
  { label: 'Google Workspace', providerName: 'Google', protocol: 'oidc' },
  { label: 'Okta', providerName: 'Okta', protocol: 'saml' },
  { label: 'Microsoft Entra ID', providerName: 'Entra ID', protocol: 'saml' },
  { label: 'Custom OIDC', providerName: 'Custom OIDC', protocol: 'oidc' },
  { label: 'Custom SAML', providerName: 'Custom SAML', protocol: 'saml' },
]

const STATUS_CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: '#DCFCE7', fg: '#15803D', label: 'Active' },
  pending: { bg: '#FEF3C7', fg: '#B45309', label: 'Not yet used' },
  error: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Error' },
}

const label = { fontSize: 13.5, fontWeight: 600, color: 'text.primary', mb: 0.75, mt: 2.5 }

export function SsoSettingsPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const origin = window.location.origin
  const slug = user?.workspace.slug ?? ''

  const [providerName, setProviderName] = useState('Authly')
  const [protocol, setProtocol] = useState<Protocol>('oidc')
  const [discoveryEndpoint, setDiscoveryEndpoint] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('') // blank = leave unchanged
  const [hasSecret, setHasSecret] = useState(false)
  const [idpMetadataUrl, setIdpMetadataUrl] = useState('')
  const [idpMetadataXml, setIdpMetadataXml] = useState('')
  const [spEntityId, setSpEntityId] = useState('')
  const [mappings, setMappings] = useState<GroupMapping[]>([])
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const ssoQuery = useQuery({ queryKey: ['sso'], queryFn: getSso })
  const conn = ssoQuery.data

  useEffect(() => {
    if (!conn) return
    setProviderName(conn.providerName)
    setProtocol(conn.protocol)
    setDiscoveryEndpoint(conn.discoveryEndpoint ?? '')
    setClientId(conn.clientId ?? '')
    setHasSecret(conn.hasClientSecret)
    setIdpMetadataUrl(conn.idpMetadataUrl ?? '')
    setIdpMetadataXml(conn.idpMetadataXml ?? '')
    setSpEntityId(conn.spEntityId ?? '')
    setMappings(conn.groupMappings)
  }, [conn])

  const save = useMutation({
    mutationFn: () => {
      const body: SaveSsoBody = {
        providerName,
        protocol,
        groupMappings: mappings.filter((m) => m.groupName.trim()),
        // Secret: only send when the admin typed a new one (blank leaves it).
        clientSecret: clientSecret === '' ? null : clientSecret,
      }
      if (protocol === 'oidc') {
        body.discoveryEndpoint = discoveryEndpoint.trim()
        body.clientId = clientId.trim()
      } else {
        body.idpMetadataUrl = idpMetadataUrl.trim() || null
        body.idpMetadataXml = idpMetadataXml.trim() || null
        body.spEntityId = spEntityId.trim() || null
      }
      return saveSso(body)
    },
    onSuccess: () => {
      setClientSecret('')
      setMessage({ kind: 'success', text: 'SSO saved. Test it by signing in from an incognito window.' })
      queryClient.invalidateQueries({ queryKey: ['sso'] })
    },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  })

  const remove = useMutation({
    mutationFn: deleteSso,
    onSuccess: () => {
      setMessage({ kind: 'success', text: 'SSO disabled.' })
      queryClient.invalidateQueries({ queryKey: ['sso'] })
    },
  })

  const redirectUri = protocol === 'oidc' ? `${origin}/api/auth/sso/callback` : `${origin}/api/auth/saml/acs`
  const chip = conn ? STATUS_CHIP[conn.status] ?? STATUS_CHIP.pending : null

  const applyPreset = (label: string) => {
    const preset = PRESETS.find((p) => p.label === label)
    if (!preset) return
    setProviderName(preset.providerName)
    setProtocol(preset.protocol)
  }

  return (
    <AppShell>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, mb: 0.5 }}>
        <Typography variant="h5">Single sign-on</Typography>
        {chip && <Chip label={chip.label} size="small" sx={{ bgcolor: chip.bg, color: chip.fg, fontWeight: 700 }} />}
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Let your team sign in with your existing identity provider. Roles come from Trackly — map IdP groups to roles below.
      </Typography>

      <Box sx={{ maxWidth: 720 }}>
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 3, boxShadow: shadows.soft }}>
          <Typography sx={{ ...label, mt: 0 }}>Provider</Typography>
          <TextField
            select
            fullWidth
            value={PRESETS.find((p) => p.providerName === providerName)?.label ?? 'Custom OIDC'}
            onChange={(e) => applyPreset(e.target.value)}
          >
            {PRESETS.map((p) => (
              <MenuItem key={p.label} value={p.label}>
                {p.label} · {p.protocol.toUpperCase()}
              </MenuItem>
            ))}
          </TextField>

          {protocol === 'oidc' ? (
            <>
              <Typography sx={label}>Discovery endpoint</Typography>
              <TextField
                fullWidth
                placeholder="https://idp.example.com/.well-known/openid-configuration"
                value={discoveryEndpoint}
                onChange={(e) => setDiscoveryEndpoint(e.target.value)}
              />
              <Typography sx={label}>Client ID</Typography>
              <TextField fullWidth value={clientId} onChange={(e) => setClientId(e.target.value)} />
              <Typography sx={label}>Client secret {hasSecret && <Chip label="saved" size="small" sx={{ ml: 1 }} />}</Typography>
              <TextField
                fullWidth
                type="password"
                placeholder={hasSecret ? '•••••••• (leave blank to keep)' : 'Optional for public clients'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </>
          ) : (
            <>
              <Typography sx={label}>IdP metadata URL</Typography>
              <TextField
                fullWidth
                placeholder="https://idp.example.com/app/metadata"
                value={idpMetadataUrl}
                onChange={(e) => setIdpMetadataUrl(e.target.value)}
              />
              <Typography sx={label}>…or paste IdP metadata XML</Typography>
              <TextField
                fullWidth
                multiline
                minRows={3}
                placeholder="<EntityDescriptor …>"
                value={idpMetadataXml}
                onChange={(e) => setIdpMetadataXml(e.target.value)}
                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 12.5 } }}
              />
              <Typography sx={label}>SP Entity ID (optional)</Typography>
              <TextField
                fullWidth
                placeholder={`${origin}/saml/${slug}`}
                value={spEntityId}
                onChange={(e) => setSpEntityId(e.target.value)}
              />
              <Alert severity="info" sx={{ mt: 1.5, fontSize: 13 }}>
                Give your IdP this SP metadata URL:{' '}
                <b>{`${origin}/api/auth/saml/metadata?workspace=${slug}`}</b>
              </Alert>
            </>
          )}

          <Alert severity="info" sx={{ mt: 2.5, fontSize: 13 }}>
            Register this redirect URI at your IdP: <b>{redirectUri}</b>
          </Alert>

          <Divider sx={{ my: 3 }} />

          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Group → role mapping</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13, mb: 1.5 }}>
            Re-evaluated on every login. Highest match wins. Leave empty to manage roles manually.
          </Typography>
          <Stack spacing={1}>
            {mappings.map((m, i) => (
              <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="IdP group name"
                  value={m.groupName}
                  onChange={(e) =>
                    setMappings((prev) => prev.map((x, j) => (j === i ? { ...x, groupName: e.target.value } : x)))
                  }
                />
                <TextField
                  size="small"
                  select
                  value={m.tracklyRole}
                  onChange={(e) =>
                    setMappings((prev) => prev.map((x, j) => (j === i ? { ...x, tracklyRole: e.target.value } : x)))
                  }
                  sx={{ width: 140 }}
                >
                  <MenuItem value="customer">Customer</MenuItem>
                  <MenuItem value="agent">Agent</MenuItem>
                  <MenuItem value="admin">Admin</MenuItem>
                </TextField>
                <IconButton
                  size="small"
                  onClick={() => setMappings((prev) => prev.filter((_, j) => j !== i))}
                  sx={{ color: 'text.secondary' }}
                >
                  ✕
                </IconButton>
              </Stack>
            ))}
          </Stack>
          <Button
            size="small"
            sx={{ mt: 1 }}
            onClick={() => setMappings((prev) => [...prev, { groupName: '', tracklyRole: 'agent' }])}
          >
            + Add mapping
          </Button>

          {message && <Alert severity={message.kind} sx={{ mt: 2.5 }}>{message.text}</Alert>}

          <Stack direction="row" spacing={1.5} sx={{ mt: 3, alignItems: 'center' }}>
            <Button variant="contained" size="large" disabled={save.isPending} onClick={() => save.mutate()}>
              Save SSO
            </Button>
            {conn && (
              <Button color="error" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Disable SSO
              </Button>
            )}
          </Stack>
        </Paper>
      </Box>
    </AppShell>
  )
}
