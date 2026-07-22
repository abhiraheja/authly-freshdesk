import { Avatar, Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import type { PublicBranding } from '../api/guest'

// Customer-facing frame: the WORKSPACE's brand (logo, colour, title) — never
// Trackly's, and always light regardless of the Trackly colour mode. Trackly
// appears only in the "Powered by" footer. See invariant 6 in CLAUDE.md.
export function BrandedFrame({
  branding,
  maxWidth = 560,
  headerRight,
  children,
}: {
  branding: PublicBranding
  maxWidth?: number
  headerRight?: ReactNode
  children: ReactNode
}) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#F6F4FA', pb: 9 }}>
      <Box sx={{ bgcolor: branding.primaryColor, color: '#fff', py: 2.25 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', maxWidth, mx: 'auto', px: 2 }}>
          {branding.logoUrl ? (
            <Avatar src={branding.logoUrl} variant="rounded" sx={{ width: 34, height: 34, bgcolor: '#fff' }} />
          ) : (
            <Avatar
              variant="rounded"
              sx={{
                width: 34,
                height: 34,
                bgcolor: '#fff',
                color: branding.primaryColor,
                fontWeight: 800,
                fontSize: 16,
              }}
            >
              {branding.workspaceName.charAt(0).toUpperCase()}
            </Avatar>
          )}
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>{branding.pageTitle}</Typography>
          <Box sx={{ ml: 'auto' }}>{headerRight}</Box>
        </Stack>
      </Box>
      <Box sx={{ maxWidth, mx: 'auto', px: 2, mt: 3.5 }}>
        {children}
        {!branding.hidePoweredBy && (
          <Typography sx={{ textAlign: 'center', color: '#C4BFD4', fontSize: 12, mt: 2.75 }}>
            {branding.footerText ? `${branding.footerText} · ` : ''}Powered by Trackly
          </Typography>
        )}
      </Box>
    </Box>
  )
}

export function BrandedCard({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        bgcolor: '#fff',
        color: '#1E1B2E',
        borderRadius: '16px',
        border: '1px solid #E9E4F5',
        boxShadow: '0 6px 24px -8px rgba(30,27,46,.08)',
        p: { xs: 3, sm: 4.5 },
      }}
    >
      {children}
    </Box>
  )
}
