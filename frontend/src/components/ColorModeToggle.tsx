import { IconButton, Tooltip } from '@mui/material'
import { useColorScheme } from '@mui/material/styles'

// Trackly-owned surfaces only. Customer-facing branded pages stay light —
// their palette belongs to the workspace, not to Trackly.
export function ColorModeToggle() {
  const { mode, systemMode, setMode } = useColorScheme()
  const resolved = mode === 'system' ? systemMode : mode
  const next = resolved === 'dark' ? 'light' : 'dark'

  return (
    <Tooltip title={`Switch to ${next} mode`}>
      <IconButton
        onClick={() => setMode(next)}
        size="small"
        sx={{ color: 'text.secondary' }}
        aria-label={`Switch to ${next} mode`}
      >
        {resolved === 'dark' ? '☀️' : '🌙'}
      </IconButton>
    </Tooltip>
  )
}
