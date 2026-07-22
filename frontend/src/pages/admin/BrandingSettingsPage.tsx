import { Alert, Avatar, Box, Button, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { getAdminBranding, saveAdminBranding, uploadLogo } from '../../api/admin'
import { AppShell } from '../../components/AppShell'
import { useAuthStore } from '../../store/auth'
import { shadows } from '../../theme'

const SWATCHES = ['#4F46E5', '#7C3AED', '#DC2626', '#16A34A', '#EA580C', '#0F172A']

export function BrandingSettingsPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const [color, setColor] = useState('#2563EB')
  const [title, setTitle] = useState('')
  const [welcome, setWelcome] = useState('')
  const [footer, setFooter] = useState('')
  const [hidePoweredBy, setHidePoweredBy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [logoVersion, setLogoVersion] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const brandingQuery = useQuery({ queryKey: ['admin-branding'], queryFn: getAdminBranding })
  const branding = brandingQuery.data

  useEffect(() => {
    if (branding) {
      setColor(branding.primaryColor)
      setTitle(branding.pageTitle ?? '')
      setWelcome(branding.welcomeText ?? '')
      setFooter(branding.footerText ?? '')
      setHidePoweredBy(branding.hidePoweredBy)
    }
  }, [branding])

  const save = useMutation({
    mutationFn: () =>
      saveAdminBranding({
        primaryColor: color,
        pageTitle: title,
        welcomeText: welcome,
        footerText: footer,
        hidePoweredBy,
      }),
    onSuccess: () => {
      setMessage({ kind: 'success', text: 'Branding saved. Customer-facing pages update within a minute.' })
      queryClient.invalidateQueries({ queryKey: ['admin-branding'] })
      queryClient.invalidateQueries({ queryKey: ['branding'] })
    },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  })

  const logo = useMutation({
    mutationFn: (file: File) => uploadLogo(file),
    onSuccess: () => {
      setMessage({ kind: 'success', text: 'Logo updated.' })
      setLogoVersion((v) => v + 1)
      queryClient.invalidateQueries({ queryKey: ['admin-branding'] })
    },
    onError: (e: Error) => setMessage({ kind: 'error', text: e.message }),
  })

  const slug = user?.workspace.slug
  const logoUrl = branding?.hasLogo && slug ? `/api/public/workspaces/${slug}/logo?v=${logoVersion}` : null
  const previewTitle = title || `${user?.workspace.name ?? ''} Support`
  const label = { fontSize: 13.5, fontWeight: 600, color: 'text.primary', mb: 0.75, mt: 2.5 }

  return (
    <AppShell>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Branding</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Your customers see <b>your</b> brand — not Trackly's. Applies to the submit form, portal and ticket emails.
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
        <Paper variant="outlined" sx={{ borderRadius: '18px', p: 3.5, flex: 1, maxWidth: 520, boxShadow: shadows.soft }}>
          <Typography sx={{ ...label, mt: 0 }}>Logo</Typography>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/svg+xml,image/jpeg,image/webp"
            hidden
            onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])}
          />
          <Box
            onClick={() => fileInput.current?.click()}
            sx={{
              border: '2px dashed',
              borderColor: 'divider',
              borderRadius: '12px',
              p: 2.5,
              textAlign: 'center',
              color: 'text.secondary',
              fontSize: 14,
              bgcolor: 'surfaceMuted',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1.5,
            }}
          >
            {logoUrl && <Avatar src={logoUrl} variant="rounded" sx={{ width: 34, height: 34, bgcolor: '#fff' }} />}
            ⬆ {logoUrl ? 'Replace logo' : 'Upload'} — PNG/SVG, max 1 MB
          </Box>

          <Typography sx={label}>Brand colour</Typography>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            {SWATCHES.map((swatch) => (
              <Box
                key={swatch}
                onClick={() => setColor(swatch)}
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '9px',
                  bgcolor: swatch,
                  cursor: 'pointer',
                  border: '2px solid',
                  borderColor: color === swatch ? 'text.primary' : 'transparent',
                  boxShadow: color === swatch ? 'inset 0 0 0 2px #fff' : 'none',
                }}
              />
            ))}
            <TextField
              size="small"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              sx={{ width: 110, '& .MuiInputBase-input': { fontSize: 13.5, fontFamily: 'monospace' } }}
            />
          </Stack>

          <Typography sx={label}>Portal title</Typography>
          <TextField
            fullWidth
            placeholder={`${user?.workspace.name ?? ''} Support`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <Typography sx={label}>Welcome text</Typography>
          <TextField
            fullWidth
            placeholder="How can we help you?"
            value={welcome}
            onChange={(e) => setWelcome(e.target.value)}
          />

          <Typography sx={label}>Footer text (optional)</Typography>
          <TextField fullWidth value={footer} onChange={(e) => setFooter(e.target.value)} />

          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 2.5 }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>Hide "Powered by Trackly"</Typography>
            <Switch checked={hidePoweredBy} onChange={(e) => setHidePoweredBy(e.target.checked)} />
          </Stack>

          {message && <Alert severity={message.kind} sx={{ mt: 2 }}>{message.text}</Alert>}
          <Button variant="contained" size="large" sx={{ mt: 2.5 }} disabled={save.isPending} onClick={() => save.mutate()}>
            Save branding
          </Button>
        </Paper>

        {/* Live preview — always light, because that is how customers see it */}
        <Box sx={{ width: { xs: '100%', md: 340 } }}>
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 700,
              color: 'text.secondary',
              letterSpacing: 1,
              textTransform: 'uppercase',
              mb: 1,
            }}
          >
            Live preview — customer form
          </Typography>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden' }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', bgcolor: color, color: '#fff', px: 2, py: 1.5 }}>
              {logoUrl ? (
                <Avatar src={logoUrl} variant="rounded" sx={{ width: 22, height: 22, bgcolor: '#fff' }} />
              ) : (
                <Avatar variant="rounded" sx={{ width: 22, height: 22, bgcolor: '#fff', color, fontSize: 12, fontWeight: 800 }}>
                  {(user?.workspace.name ?? 'W').charAt(0)}
                </Avatar>
              )}
              <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{previewTitle}</Typography>
            </Stack>
            <Box sx={{ p: 2, bgcolor: '#FAFAFA', fontSize: 12, color: '#64748B' }}>
              {welcome || 'How can we help you?'}
              <Box sx={{ height: 26, bgcolor: '#fff', border: '1px solid #E2E8F0', borderRadius: '7px', mt: 0.75 }} />
              <Box sx={{ height: 26, bgcolor: '#fff', border: '1px solid #E2E8F0', borderRadius: '7px', mt: 0.75 }} />
              <Box sx={{ height: 28, width: 110, bgcolor: color, borderRadius: '7px', mt: 1.25 }} />
            </Box>
          </Box>
          <Button size="small" sx={{ mt: 1.5, color: 'text.secondary' }} href={`/submit?workspace=${slug}`} target="_blank">
            Open the real form ↗
          </Button>
        </Box>
      </Stack>
    </AppShell>
  )
}
