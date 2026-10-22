// Keep application, Chromium media queries and MUI on one effective theme.
export function appThemeSource(settings: {
  darkMode: boolean;
  adaptableDarkMode: boolean;
}): 'dark' | 'light' | 'system' {
  // Preserve explicit dark preferences saved by earlier versions.
  return settings.darkMode
    ? 'dark'
    : settings.adaptableDarkMode
      ? 'system'
      : 'light';
}
