import { appThemeSource } from '../src/features/appearance/theme';

describe('application Chromium theme source', () => {
  it.each([
    [false, true, 'system'],
    [false, false, 'light'],
    [true, false, 'dark'],
    [true, true, 'dark'],
  ] as const)(
    'uses dark=%s, follow system=%s as %s',
    (darkMode, adaptableDarkMode, source) => {
      expect(appThemeSource({ darkMode, adaptableDarkMode })).toBe(source);
    },
  );
});
