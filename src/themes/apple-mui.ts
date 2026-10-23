// MUI theme options that make Material components behave like native Apple
// controls: no ripples or elevation, sentence-case labels, system typography,
// rounded continuous corners, translucent menus and short, calm transitions.
// Colours reference the CSS design tokens (src/styles/zl-design.scss) where MUI
// passes them straight to CSS, so light/dark/accent stay in sync automatically.
import type { ThemeOptions } from '@mui/material/styles';

const FONT_STACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"SF Pro Text"',
  '"PingFang SC"',
  '"Segoe UI Variable Text"',
  '"Segoe UI"',
  '"Microsoft YaHei UI"',
  '"Microsoft YaHei"',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(',');

export const APPLE_SYSTEM_COLORS = {
  light: {
    red: '#FF3B30',
    orange: '#FF9500',
    green: '#34C759',
    blue: '#007AFF',
    gray: '#8E8E93',
    background: '#F5F5F7',
    paper: '#FFFFFF',
    text: 'rgba(0, 0, 0, 0.88)',
    textSecondary: 'rgba(0, 0, 0, 0.56)',
    divider: 'rgba(60, 60, 67, 0.16)',
  },
  dark: {
    red: '#FF453A',
    orange: '#FF9F0A',
    green: '#30D158',
    blue: '#0A84FF',
    gray: '#98989D',
    background: '#1C1C1E',
    paper: '#2C2C2E',
    text: 'rgba(255, 255, 255, 0.92)',
    textSecondary: 'rgba(235, 235, 245, 0.62)',
    divider: 'rgba(84, 84, 88, 0.6)',
  },
} as const;

export const appleMuiThemeOptions = (
  mode: 'light' | 'dark',
  accent: string,
): ThemeOptions => {
  const c = APPLE_SYSTEM_COLORS[mode];
  return {
    palette: {
      mode,
      primary: { main: accent },
      error: { main: c.red },
      warning: { main: c.orange },
      success: { main: c.green },
      info: { main: c.blue },
      background: { default: c.background, paper: c.paper },
      text: { primary: c.text, secondary: c.textSecondary },
      divider: c.divider,
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: FONT_STACK,
      fontSize: 13,
      htmlFontSize: 10, // html { font-size: 62.5% }
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
      h6: { fontSize: 17, fontWeight: 600, letterSpacing: 0 },
      body1: { fontSize: 13, letterSpacing: 0 },
      body2: { fontSize: 12, letterSpacing: 0 },
    },
    transitions: {
      duration: {
        shortest: 100,
        shorter: 150,
        short: 180,
        standard: 220,
        complex: 280,
        enteringScreen: 220,
        leavingScreen: 160,
      },
      easing: {
        easeInOut: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        easeOut: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
        sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
      },
    },
    components: {
      // Native controls highlight instead of rippling.
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 'var(--zl-radius-sm, 6px)',
            minHeight: 28,
            padding: '4px 14px',
            transition:
              'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
            '&:focus-visible': { boxShadow: 'var(--zl-focus-ring)' },
          },
          text: {
            '&:hover': { backgroundColor: 'var(--zl-hover)' },
            '&:active': { backgroundColor: 'var(--zl-pressed)' },
          },
          outlined: {
            borderColor: 'var(--zl-border-control)',
            backgroundColor: 'var(--zl-bg-control)',
            color: 'var(--zl-label)',
            '&:hover': {
              borderColor: 'var(--zl-border-control)',
              backgroundColor: 'var(--zl-bg-control)',
              filter: 'brightness(0.97)',
            },
          },
          contained: {
            '&:active': { filter: 'brightness(0.92)' },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 'var(--zl-radius-sm, 6px)',
            '&:hover': { backgroundColor: 'var(--zl-hover)' },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiBackdrop: {
        styleOverrides: {
          root: {
            backgroundColor: 'var(--zl-scrim)',
            '&.MuiBackdrop-invisible': { backgroundColor: 'transparent' },
          },
        },
      },
      // Sheets / alerts.
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 'var(--zl-radius-xl, 14px)',
            boxShadow: 'var(--zl-shadow-sheet)',
            backgroundColor: 'var(--zl-bg-elevated)',
            color: 'var(--zl-label)',
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { fontSize: 15, fontWeight: 600, padding: '18px 20px 6px' },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: { fontSize: 13, lineHeight: 1.5, padding: '6px 20px 12px' },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: { padding: '8px 16px 16px', gap: 8 },
          spacing: { '& > :not(style) ~ :not(style)': { marginLeft: 0 } },
        },
      },
      // Menus and popovers use a translucent material.
      MuiPopover: {
        styleOverrides: {
          paper: {
            borderRadius: 'var(--zl-radius-lg, 10px)',
            boxShadow: 'var(--zl-shadow-popover)',
            backgroundColor: 'var(--zl-material-thick)',
            backdropFilter: 'var(--zl-material-blur)',
            color: 'var(--zl-label)',
          },
        },
      },
      MuiMenu: {
        defaultProps: { transitionDuration: 140 },
        styleOverrides: { list: { padding: 5 } },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontSize: 13,
            minHeight: 26,
            borderRadius: 'var(--zl-radius-xs, 4px)',
            padding: '4px 10px',
            '&:hover, &.Mui-focusVisible': {
              backgroundColor: 'var(--zl-accent)',
              color: 'var(--zl-on-accent)',
            },
            '&.Mui-selected, &.Mui-selected:hover': {
              backgroundColor: 'var(--zl-accent-tint)',
              color: 'inherit',
            },
          },
        },
      },
      MuiTooltip: {
        defaultProps: { enterDelay: 600, enterNextDelay: 200, arrow: false },
        styleOverrides: {
          tooltip: {
            fontSize: 11,
            fontWeight: 400,
            padding: '4px 8px',
            borderRadius: 'var(--zl-radius-sm, 6px)',
            backgroundColor: 'var(--zl-material-thick)',
            backdropFilter: 'var(--zl-material-blur)',
            color: 'var(--zl-label)',
            boxShadow: 'var(--zl-shadow-popover)',
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 'var(--zl-radius-sm, 6px)',
            backgroundColor: 'var(--zl-bg-field)',
            fontSize: 13,
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderWidth: 1,
              borderColor: 'var(--zl-accent)',
              boxShadow: 'var(--zl-focus-ring)',
            },
          },
          notchedOutline: { borderColor: 'var(--zl-border-control)' },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 46, height: 28, padding: 3 },
          switchBase: {
            padding: 5,
            '&.Mui-checked': { transform: 'translateX(18px)' },
            '&.Mui-checked + .MuiSwitch-track': {
              opacity: 1,
              backgroundColor: 'var(--zl-accent)',
            },
          },
          thumb: {
            width: 18,
            height: 18,
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            color: '#fff',
          },
          track: {
            borderRadius: 11,
            opacity: 1,
            backgroundColor: 'var(--zl-fill)',
          },
        },
      },
      MuiCheckbox: { defaultProps: { disableRipple: true } },
      MuiTab: {
        styleOverrides: { root: { textTransform: 'none', minHeight: 36 } },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 999, height: 4 },
          bar: { borderRadius: 999 },
        },
      },
    },
  };
};
