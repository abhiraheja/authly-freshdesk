import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import {
  createGuestTicket,
  getPublicBranding,
  sendGuestOtp,
  uploadGuestAttachment,
  verifyGuestOtp,
  type GuestTicketCreated,
} from '../../api/guest'
import { BrandedCard, BrandedFrame } from '../../components/BrandedFrame'
import { CodeInput } from '../../components/CodeInput'
import { formatBytes } from '../../lib/format'

type Stage = 'form' | 'otp' | 'done'

// Three stages per the approved mockup: form → OTP → confirmation.
export function SubmitPage() {
  const [params] = useSearchParams()
  const slug = params.get('workspace') ?? ''
  const navigate = useNavigate()

  const [stage, setStage] = useState<Stage>('form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [code, setCode] = useState('')
  const [created, setCreated] = useState<GuestTicketCreated | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const brandingQuery = useQuery({
    queryKey: ['branding', slug],
    queryFn: () => getPublicBranding(slug),
    enabled: !!slug,
    retry: false,
  })

  const sendOtp = useMutation({
    mutationFn: () => sendGuestOtp(email, slug),
    onSuccess: () => {
      setError(null)
      setCode('')
      setStage('otp')
    },
    onError: (e: Error) => setError(e.message),
  })

  const verifyAndSubmit = useMutation({
    mutationFn: async () => {
      const { submissionToken } = await verifyGuestOtp(email, code, slug)
      const ticket = await createGuestTicket(slug, {
        submissionToken,
        name,
        subject,
        description,
        categoryId: categoryId || undefined,
      })
      if (file) await uploadGuestAttachment(ticket.ticketId, ticket.guestToken, file)
      return ticket
    },
    onSuccess: (ticket) => {
      setError(null)
      setCreated(ticket)
      setStage('done')
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!slug) {
    return (
      <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
        Missing workspace. Use a link like <code>/submit?workspace=acme</code>.
      </Box>
    )
  }
  if (brandingQuery.isPending) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }
  const branding = brandingQuery.data
  if (!branding) {
    return <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>Workspace not found.</Box>
  }

  const brandBtn = {
    bgcolor: branding.primaryColor,
    boxShadow: 'none',
    '&:hover': { bgcolor: branding.primaryColor, filter: 'brightness(0.92)' },
  }
  const label = { fontSize: 13.5, fontWeight: 600, color: '#374151', mb: 0.75 }

  return (
    <BrandedFrame
      branding={branding}
      headerRight={
        <Link
          component={RouterLink}
          to={`/login?workspace=${slug}`}
          sx={{ color: '#fff', opacity: 0.85, fontSize: 13, textDecoration: 'none' }}
        >
          My tickets →
        </Link>
      }
    >
      {stage === 'form' && (
        <BrandedCard>
          <Typography sx={{ fontSize: 24, fontWeight: 700, textAlign: 'center', mb: 1, letterSpacing: '-0.3px' }}>
            {branding.welcomeText}
          </Typography>
          <Typography sx={{ textAlign: 'center', color: '#6B7280', fontSize: 14.5, mb: 3 }}>
            We usually respond within a couple of hours.
          </Typography>

          {branding.emailLoginEnabled && (
            <>
              <Button
                fullWidth
                size="large"
                variant="contained"
                sx={brandBtn}
                onClick={() => navigate(`/login?workspace=${slug}`)}
              >
                🔐 Sign in →
              </Button>
              <Typography sx={{ textAlign: 'center', fontSize: 12.5, color: '#9CA3AF', mt: 1 }}>
                Use your {branding.workspaceName} account — your tickets appear in your portal
              </Typography>
              <Divider sx={{ my: 3, fontSize: 13, color: '#9CA3AF' }}>or continue as a guest</Divider>
            </>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim() && email.includes('@') && subject.trim() && description.trim()) sendOtp.mutate()
            }}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.75}>
              <Box sx={{ flex: 1 }}>
                <Typography sx={label}>
                  Your name <Box component="span" sx={{ color: '#DC2626' }}>*</Box>
                </Typography>
                <TextField fullWidth value={name} onChange={(e) => setName(e.target.value)} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={label}>
                  Email <Box component="span" sx={{ color: '#DC2626' }}>*</Box>
                </Typography>
                <TextField fullWidth type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Box>
            </Stack>

            {branding.categories.length > 0 && (
              <>
                <Typography sx={{ ...label, mt: 2 }}>Category</Typography>
                <TextField select fullWidth value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <MenuItem value="">General</MenuItem>
                  {branding.categories.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}

            <Typography sx={{ ...label, mt: 2 }}>
              Subject <Box component="span" sx={{ color: '#DC2626' }}>*</Box>
            </Typography>
            <TextField fullWidth value={subject} onChange={(e) => setSubject(e.target.value)} />

            <Typography sx={{ ...label, mt: 2 }}>
              Describe the issue <Box component="span" sx={{ color: '#DC2626' }}>*</Box>
            </Typography>
            <TextField
              fullWidth
              multiline
              minRows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <input ref={fileInput} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Box
              onClick={() => fileInput.current?.click()}
              sx={{
                border: '2px dashed #D8D2E8',
                borderRadius: '11px',
                p: 2,
                textAlign: 'center',
                color: '#6B7280',
                fontSize: 13.5,
                bgcolor: '#FBFAFE',
                mt: 2,
                cursor: 'pointer',
              }}
            >
              {file ? (
                <>📎 {file.name} · {formatBytes(file.size)}</>
              ) : (
                <>
                  📎 Attach screenshots or files —{' '}
                  <Box component="b" sx={{ color: branding.primaryColor }}>browse</Box> (max 10 MB)
                </>
              )}
            </Box>

            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            <Button
              fullWidth
              size="large"
              variant="contained"
              type="submit"
              sx={{ ...brandBtn, mt: 2.75, fontWeight: 700 }}
              disabled={
                !name.trim() || !email.includes('@') || !subject.trim() || !description.trim() || sendOtp.isPending
              }
            >
              Submit ticket
            </Button>
          </form>
        </BrandedCard>
      )}

      {stage === 'otp' && (
        <BrandedCard>
          <Typography sx={{ fontSize: 21, fontWeight: 700, textAlign: 'center', mb: 1 }}>
            Check your email 📬
          </Typography>
          <Typography sx={{ textAlign: 'center', color: '#6B7280', fontSize: 14.5, mb: 3 }}>
            We sent a 6-digit code to <b>{email}</b> to confirm it's really you.
            <br />
            The code expires in 10 minutes.
          </Typography>
          <CodeInput value={code} onChange={setCode} disabled={verifyAndSubmit.isPending} />
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
          <Button
            fullWidth
            size="large"
            variant="contained"
            sx={{ ...brandBtn, mt: 2.75, fontWeight: 700 }}
            disabled={code.length !== 6 || verifyAndSubmit.isPending}
            onClick={() => verifyAndSubmit.mutate()}
          >
            Verify &amp; submit ticket
          </Button>
          <Typography sx={{ textAlign: 'center', fontSize: 13.5, color: '#6B7280', mt: 1.75 }}>
            Didn't get it?{' '}
            <Link
              component="button"
              type="button"
              underline="hover"
              sx={{ color: branding.primaryColor, fontWeight: 600 }}
              onClick={() => sendOtp.mutate()}
            >
              Resend code
            </Link>{' '}
            · <Box component="span" sx={{ color: '#C4BFD4' }}>3 sends max per 15 min</Box>
          </Typography>
        </BrandedCard>
      )}

      {stage === 'done' && created && (
        <BrandedCard>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              bgcolor: '#F0FDF4',
              color: '#16A34A',
              fontSize: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 2.25,
            }}
          >
            ✓
          </Box>
          <Typography sx={{ fontSize: 21, fontWeight: 700, textAlign: 'center', mb: 1 }}>
            Ticket submitted!
          </Typography>
          <Typography sx={{ textAlign: 'center', color: '#6B7280', fontSize: 14.5, mb: 2.25 }}>
            We've emailed you a confirmation with a private link to track this ticket — no account needed.
          </Typography>
          <Box
            sx={{
              bgcolor: '#FBFAFE',
              border: '1.5px dashed #D8D2E8',
              borderRadius: '11px',
              p: 1.75,
              textAlign: 'center',
              fontSize: 14,
              color: '#374151',
              mb: 2.25,
            }}
          >
            Your reference number
            <Typography sx={{ fontSize: 19, fontWeight: 700, color: branding.primaryColor, letterSpacing: 1 }}>
              {created.reference}
            </Typography>
          </Box>
          <Button
            fullWidth
            size="large"
            variant="outlined"
            sx={{
              color: branding.primaryColor,
              borderColor: branding.primaryColor,
              fontWeight: 700,
              '&:hover': { borderColor: branding.primaryColor, bgcolor: '#FBFAFE' },
            }}
            onClick={() =>
              navigate(
                `/tickets/${created.ticketId}?token=${encodeURIComponent(created.guestToken)}&workspace=${slug}`,
              )
            }
          >
            View my ticket →
          </Button>
          <Typography sx={{ textAlign: 'center', fontSize: 13, color: '#6B7280', mt: 2 }}>
            💡 Sign in later with this email and this ticket will automatically appear in your account.
          </Typography>
        </BrandedCard>
      )}
    </BrandedFrame>
  )
}
