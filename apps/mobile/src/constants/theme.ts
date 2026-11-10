/**
 * DEMANITY DESIGN TOKENS — the single place to customize the look and feel.
 *
 * Direction: modern, bold, dark-first social app. Every screen and component
 * reads colors, spacing, corner radius and type from here, so changing a value
 * below restyles the whole app (iOS, Android and web).
 *
 * Accent color: violet, deliberately neither party red nor party blue, so the
 * product never reads as partisan.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Which palette the app uses. 'dark' = dark-first (current design);
 * 'system' = follow the device setting.
 */
export const ColorMode: 'dark' | 'light' | 'system' = 'dark';

export const Colors = {
  dark: {
    text: '#F5F6F8', // primary text
    textSecondary: '#8B919C', // handles, timestamps, hints
    background: '#000000', // app background
    backgroundElement: '#16181C', // cards, inputs, chips
    backgroundSelected: '#2F3336', // hairline borders, pressed states
    surfaceRaised: '#1E2025', // modals, sticky bars
  },
  light: {
    text: '#0F1419',
    textSecondary: '#536471',
    background: '#FFFFFF',
    backgroundElement: '#F2F3F5',
    backgroundSelected: '#E1E4E8',
    surfaceRaised: '#FFFFFF',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Brand and meaning colors (shared by both palettes). */
export const Brand = {
  primary: '#8B5CF6', // violet: main buttons, links, active tab, focus rings
  primaryPressed: '#7C3AED',
  onPrimary: '#FFFFFF', // text/icons on primary
  danger: '#F4212E', // errors, destructive actions
  like: '#22C55E',
  dislike: '#F97316',
  kudos: '#FBBF24', // Humanity's only reaction
  humanity: '#F59E0B', // accent for the Humanity section
  location: '#14B8A6', // place communities
  topic: '#8B5CF6', // topic communities
} as const;

/**
 * Avatar backgrounds (initials avatars until photos exist). Deliberately
 * excludes party red and blue.
 */
export const AvatarPalette = [
  '#8B5CF6',
  '#14B8A6',
  '#F59E0B',
  '#EC4899',
  '#10B981',
  '#6366F1',
  '#F97316',
  '#06B6D4',
] as const;

/** Corner radius scale. */
export const Radius = {
  small: 8,
  medium: 14,
  large: 20,
  pill: 999,
} as const;

/** Type scale (bold, high-contrast). Used by ThemedText `type`. */
export const Type = {
  title: { fontSize: 40, lineHeight: 44, fontWeight: 900 }, // hero headlines
  subtitle: { fontSize: 28, lineHeight: 34, fontWeight: 800 }, // screen titles
  headline: { fontSize: 17, lineHeight: 22, fontWeight: 800 }, // post titles, names
  default: { fontSize: 16, lineHeight: 22, fontWeight: 400 }, // body
  small: { fontSize: 14, lineHeight: 19, fontWeight: 400 },
  smallBold: { fontSize: 14, lineHeight: 19, fontWeight: 700 },
  caption: { fontSize: 13, lineHeight: 17, fontWeight: 500 },
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
/** Width of the main column on wide screens (like large social apps). */
export const MaxContentWidth = 640;
