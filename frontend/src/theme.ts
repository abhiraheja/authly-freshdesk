import { createTheme } from '@mui/material/styles'

// Design tokens from docs/mockups (02-onboarding.html et al.)
export const theme = createTheme({
  palette: {
    primary: { main: '#2563EB' },
    secondary: { main: '#7C3AED' },
    background: { default: '#F1F5F9', paper: '#FFFFFF' },
    text: { primary: '#0F172A', secondary: '#64748B' },
    divider: '#E2E8F0',
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    h5: { fontWeight: 700, letterSpacing: '-0.3px' },
    button: { textTransform: 'none', fontWeight: 600, fontSize: 15 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        sizeLarge: { padding: '13px 16px' },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'medium' },
    },
  },
})
