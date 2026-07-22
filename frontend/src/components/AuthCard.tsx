import { Avatar, Box, Paper, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

function LogoMark() {
  return (
    <Box
      sx={{
        width: 28,
        height: 28,
        borderRadius: '8px',
        background: 'linear-gradient(135deg, #4F46E5, #A78BFA)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 14,
      }}
    >
      ◆
    </Box>
  )
}

// Invariant 6: a workspace-scoped auth screen is customer-facing, so it wears
// the workspace's brand, never Trackly's.
export interface AuthCardBrand {
  name: string
  logoUrl: string | null
  color: string
}

export function StepDots({ done, total = 5 }: { done: number; total?: number }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'center', mb: 3.5 }}>
      {Array.from({ length: total }, (_, i) => (
        <Box
          key={i}
          sx={{
            width: 34,
            height: 5,
            borderRadius: 99,
            bgcolor: i < done ? 'primary.main' : '#E2E8F0',
          }}
        />
      ))}
    </Stack>
  )
}

interface AuthCardProps {
  title: string
  subtitle?: ReactNode
  stepsDone?: number
  brand?: AuthCardBrand | null
  children: ReactNode
}

export function AuthCard({ title, subtitle, stepsDone, brand, children }: AuthCardProps) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'flex',
        justifyContent: 'center',
        alignItems: { xs: 'flex-start', sm: 'center' },
        px: 2,
        py: 5,
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          width: '100%',
          maxWidth: 520,
          borderRadius: '18px',
          borderColor: '#E2E8F0',
          boxShadow: '0 8px 30px -8px rgba(15,23,42,.08)',
          p: { xs: 3, sm: 5 },
        }}
      >
        <Stack direction="row" spacing={1.1} sx={{ alignItems: 'center', justifyContent: 'center', mb: 3 }}>
          {brand ? (
            <>
              {brand.logoUrl ? (
                <Avatar src={brand.logoUrl} variant="rounded" sx={{ width: 28, height: 28 }} />
              ) : (
                <Avatar
                  variant="rounded"
                  sx={{ width: 28, height: 28, bgcolor: brand.color, fontSize: 14, fontWeight: 800 }}
                >
                  {brand.name.charAt(0).toUpperCase()}
                </Avatar>
              )}
              <Typography sx={{ fontSize: 18, fontWeight: 800 }}>{brand.name}</Typography>
            </>
          ) : (
            <>
              <LogoMark />
              <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Trackly</Typography>
            </>
          )}
        </Stack>
        {stepsDone !== undefined && <StepDots done={stepsDone} />}
        <Typography variant="h5" align="center" sx={{ fontSize: 23, mb: 0.75 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography align="center" color="text.secondary" sx={{ fontSize: 14.5, mb: 3.5, lineHeight: 1.5 }}>
            {subtitle}
          </Typography>
        )}
        {children}
      </Paper>
    </Box>
  )
}
