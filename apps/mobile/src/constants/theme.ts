/**
 * DEMANITY DESIGN TOKENS — the single place to customize the look and feel.
 *
 * Every screen and component reads colors, spacing, corner radius and fonts
 * from here, so changing a value below restyles the whole app (iOS, Android
 * and web). Light and dark modes each have their own palette.
 *
 * The current values are deliberately plain placeholders, ready for the real
 * brand design.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Brand and meaning colors (same in light and dark mode unless you split them). */
export const Brand = {
  primary: '#3c87f7', // main buttons, links, active tab
  onPrimary: '#ffffff', // text on primary buttons
  danger: '#d64545', // errors, destructive actions
  like: '#2f9e61',
  dislike: '#c2552d',
  kudos: '#d4a017', // Humanity's only reaction
  humanity: '#e9a23b', // accent for the Humanity section
} as const;

/** Corner radius scale. */
export const Radius = {
  small: 8,
  medium: 12,
  large: 16,
  pill: 999,
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
