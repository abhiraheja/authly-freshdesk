import { createTheme } from '@mui/material/styles'

// Design tokens adopted from the reviewed UI concept. These style TRACKLY'S OWN
// surfaces: agent workspace, dashboard, admin, auth. Customer-facing surfaces
// (/submit, guest ticket view, portal, widget) render the WORKSPACE's brand
// instead — that is invariant 6 in CLAUDE.md.
export const brand = {
  primary: '#4F46E5',
  primaryHover: '#4338CA',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
} as const

export const shadows = {
  soft: '0 1px 2px rgba(15,23,42,.04), 0 8px 24px rgba(15,23,42,.06)',
  lift: '0 10px 40px -8px rgba(79,70,229,.25)',
} as const

// Frosted app bar / rail. Pass the current mode's value via sx.
export const glass = {
  light: { backdropFilter: 'blur(16px) saturate(160%)', backgroundColor: 'rgba(255,255,255,.72)' },
  dark: { backdropFilter: 'blur(16px) saturate(160%)', backgroundColor: 'rgba(15,23,42,.62)' },
} as const

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: brand.primary, dark: brand.primaryHover },
        secondary: { main: '#7C3AED' },
        success: { main: brand.success },
        warning: { main: brand.warning },
        error: { main: brand.danger },
        info: { main: brand.info },
        background: { default: '#F8FAFC', paper: '#FFFFFF' },
        text: { primary: '#0F172A', secondary: '#64748B' },
        divider: '#E2E8F0',
        // Muted fill for inset panels, thread backgrounds, search bars.
        surfaceMuted: '#F1F5F9',
      },
    },
    dark: {
      palette: {
        primary: { main: '#818CF8', dark: brand.primary },
        secondary: { main: '#A78BFA' },
        success: { main: '#34D399' },
        warning: { main: '#FBBF24' },
        error: { main: '#F87171' },
        info: { main: '#60A5FA' },
        background: { default: '#0F172A', paper: '#1E293B' },
        text: { primary: '#F1F5F9', secondary: '#94A3B8' },
        divider: 'rgba(255,255,255,0.10)',
        surfaceMuted: 'rgba(255,255,255,0.05)',
      },
    },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
    h5: { fontWeight: 800, letterSpacing: '-0.3px' },
    button: { textTransform: 'none', fontWeight: 600, fontSize: 15 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '*': { WebkitFontSmoothing: 'antialiased' },
        '::-webkit-scrollbar': { width: 10, height: 10 },
        '::-webkit-scrollbar-thumb': {
          background: 'rgba(100,116,139,.35)',
          borderRadius: 999,
          border: '2px solid transparent',
          backgroundClip: 'padding-box',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 12 },
        sizeLarge: { padding: '13px 16px' },
      },
      // MUI v9 removed the `containedPrimary` override key — use variants.
      variants: [
        { props: { variant: 'contained', color: 'primary' }, style: { boxShadow: shadows.lift } },
      ],
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 700 } } },
  },
})

declare module '@mui/material/styles' {
  interface Palette {
    surfaceMuted: string
  }
  interface PaletteOptions {
    surfaceMuted?: string
  }
}
