/**
 * Returns the active palette. Dark-first by default (see ColorMode in
 * constants/theme.ts); set ColorMode to 'system' to follow the device.
 */

import { ColorMode, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const system = useColorScheme(); // always called (rules of hooks)
  const scheme = ColorMode === 'system' ? (system === 'light' ? 'light' : 'dark') : ColorMode;
  return Colors[scheme];
}

export function useIsDark() {
  const system = useColorScheme();
  return ColorMode === 'system' ? system !== 'light' : ColorMode === 'dark';
}
