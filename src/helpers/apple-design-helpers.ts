// Shared helpers for the ZL-WA design system (see src/styles/zl-design.scss).

/** Apple's system blue, the default accent colour of ZL-WA. */
export const SYSTEM_BLUE = '#007AFF';

/**
 * Upstream Ferdium's default accent. Installs created before the design
 * refresh persisted it as an explicit setting even though the user never
 * chose it, so it is treated as "no preference" and mapped to system blue.
 */
export const LEGACY_DEFAULT_ACCENT = '#7367F0';

const HEX_COLOR = /^#?([\da-f]{3}|[\da-f]{6})$/i;

/** Returns the accent colour to render, normalised to `#RRGGBB`. */
export const resolveAccentColor = (value: unknown): string => {
  if (typeof value !== 'string') return SYSTEM_BLUE;
  const match = HEX_COLOR.exec(value.trim());
  if (!match) return SYSTEM_BLUE;
  let hex = match[1];
  if (hex.length === 3)
    hex = [...hex].map(character => character + character).join('');
  const normalised = `#${hex.toUpperCase()}`;
  return normalised === LEGACY_DEFAULT_ACCENT ? SYSTEM_BLUE : normalised;
};

/** `"r, g, b"` triple for use inside `rgba(var(--zl-accent-rgb), a)`. */
export const accentRgbTriple = (value: unknown): string => {
  const hex = resolveAccentColor(value).slice(1);
  return [0, 2, 4]
    .map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
    .join(', ');
};

/**
 * Text colour on top of the accent fill. Like Apple's controls this prefers
 * white and only switches to black when white would fall below the WCAG 3:1
 * contrast required for bold control labels (e.g. a yellow accent).
 */
export const onAccentColor = (value: unknown): '#FFFFFF' | '#000000' => {
  const [r, g, b] = accentRgbTriple(value)
    .split(', ')
    .map(channel => {
      const c = Number(channel) / 255;
      return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05) >= 3 ? '#FFFFFF' : '#000000';
};

/** CSS declarations exposing the accent as design tokens. */
export const accentCustomProperties = (value: unknown): string => {
  const accent = resolveAccentColor(value);
  return [
    `--zl-accent: ${accent};`,
    `--zl-accent-rgb: ${accentRgbTriple(accent)};`,
    `--zl-on-accent: ${onAccentColor(accent)};`,
  ].join(' ');
};
