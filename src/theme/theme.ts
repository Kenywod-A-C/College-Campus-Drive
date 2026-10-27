import { createTheme, alpha } from '@mui/material/styles';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

export const colors = {
  navy: '#0b1f4b',
  navyDark: '#071538',
  blue: '#2563eb',
  bg: '#f5f7fb',
  border: '#e3e8f0',
  text: '#0f172a',
  muted: '#5b6b86',
  success: '#15803d',
  warning: '#b45309',
  error: '#b91c1c',
};

// Categorical chart palette (validated for contrast on white, colour-blind friendly ordering).
export const chartColors = ['#2563eb', '#0f766e', '#d97706', '#7c3aed', '#db2777', '#475569', '#0891b2', '#65a30d'];

export const theme = createTheme({
  cssVariables: false,
  palette: {
    mode: 'light',
    primary: { main: colors.navy, dark: colors.navyDark, light: '#1e3a8a', contrastText: '#fff' },
    secondary: { main: colors.blue, contrastText: '#fff' },
    success: { main: colors.success, light: '#dcfce7' },
    warning: { main: '#d97706', dark: colors.warning, light: '#fef3c7' },
    error: { main: colors.error, light: '#fee2e2' },
    info: { main: colors.blue, light: '#dbeafe' },
    background: { default: colors.bg, paper: '#ffffff' },
    text: { primary: colors.text, secondary: colors.muted },
    divider: colors.border,
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h1: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.015em' },
    h3: { fontSize: '1.25rem', fontWeight: 650 as number },
    h4: { fontSize: '1.125rem', fontWeight: 600 },
    h5: { fontSize: '1rem', fontWeight: 600 },
    h6: { fontSize: '0.9375rem', fontWeight: 600 },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 500 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 600 },
    body1: { fontSize: '0.9375rem' },
    body2: { fontSize: '0.875rem' },
    caption: { fontSize: '0.75rem' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: colors.bg },
        '*:focus-visible': { outline: `2px solid ${colors.blue}`, outlineOffset: 2 },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 10, paddingInline: 16 },
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: { borderColor: colors.border, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', borderRadius: 14 },
      },
    },
    MuiPaper: { styleOverrides: { outlined: { borderColor: colors.border } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: 8 } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 10, backgroundColor: '#fff' } } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 44 } } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', backgroundColor: '#f8fafc', whiteSpace: 'nowrap' },
        root: { borderColor: colors.border },
      },
    },
    MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: alpha(colors.blue, 0.04) } } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 10 } } },
  },
});
