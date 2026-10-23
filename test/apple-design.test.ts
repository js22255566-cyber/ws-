import {
  accentCustomProperties,
  accentRgbTriple,
  onAccentColor,
  resolveAccentColor,
} from '../src/helpers/apple-design-helpers';
import { appleMuiThemeOptions } from '../src/themes/apple-mui';

describe('ZL-WA design system helpers', () => {
  it('maps the legacy Ferdium purple and invalid values to system blue', () => {
    expect(resolveAccentColor('#7367F0')).toBe('#007AFF');
    expect(resolveAccentColor('#7367f0')).toBe('#007AFF');
    expect(resolveAccentColor('not a colour')).toBe('#007AFF');
    expect(resolveAccentColor(undefined)).toBe('#007AFF');
  });
  it('keeps a colour the user chose, normalised to #RRGGBB', () => {
    expect(resolveAccentColor('#34c759')).toBe('#34C759');
    expect(resolveAccentColor('f60')).toBe('#FF6600');
  });
  it('exposes the accent as CSS custom properties', () => {
    expect(accentRgbTriple('#007AFF')).toBe('0, 122, 255');
    expect(accentCustomProperties('#007AFF')).toContain(
      '--zl-accent: #007AFF;',
    );
    expect(accentCustomProperties('#007AFF')).toContain(
      '--zl-accent-rgb: 0, 122, 255;',
    );
  });
  it('chooses a readable label colour on the accent fill', () => {
    expect(onAccentColor('#007AFF')).toBe('#FFFFFF');
    expect(onAccentColor('#FFD60A')).toBe('#000000');
  });
  it('builds MUI options without ripples, uppercase labels or elevation', () => {
    const options = appleMuiThemeOptions('dark', '#007AFF') as any;
    expect(options.palette.mode).toBe('dark');
    expect(options.palette.primary.main).toBe('#007AFF');
    expect(options.components.MuiButtonBase.defaultProps.disableRipple).toBe(
      true,
    );
    expect(options.components.MuiButton.defaultProps.disableElevation).toBe(
      true,
    );
    expect(options.typography.button.textTransform).toBe('none');
    expect(options.typography.htmlFontSize).toBe(10);
  });
});
