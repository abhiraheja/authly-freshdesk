import { Box, Paper, Typography } from '@mui/material'
import { shadows } from '../theme'

export interface StatCardProps {
  label: string
  value: string | number
  icon: string
  tone?: 'primary' | 'success' | 'warning' | 'error' | 'info'
  onClick?: () => void
}

// KPI tile for the agent dashboard stat row. `tone` picks the icon chip colour
// from the palette so it inverts correctly in dark mode.
export function StatCard({ label, value, icon, tone = 'primary', onClick }: StatCardProps) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        borderRadius: '18px',
        p: 2,
        boxShadow: shadows.soft,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow .2s, transform .2s',
        '&:hover': onClick ? { boxShadow: shadows.lift, transform: 'translateY(-2px)' } : undefined,
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          display: 'grid',
          placeItems: 'center',
          borderRadius: '12px',
          fontSize: 18,
          bgcolor: `${tone}.main`,
          color: `${tone}.contrastText`,
        }}
      >
        {icon}
      </Box>
      <Typography sx={{ fontSize: 26, fontWeight: 800, mt: 1.5, color: 'text.primary' }}>{value}</Typography>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>{label}</Typography>
    </Paper>
  )
}
