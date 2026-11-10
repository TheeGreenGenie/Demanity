import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AvatarPalette } from '@/constants/theme';

/**
 * Initials avatar until profile photos exist. The color is derived from the
 * username, so each person keeps a stable color everywhere.
 */
export function Avatar({ name, size = 44 }: { name: string | null; size?: number }) {
  const label = name
    ? name
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, 2)
        .toUpperCase() || '?'
    : '?';
  let hash = 0;
  for (const ch of name ?? '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = name ? AvatarPalette[hash % AvatarPalette.length] : '#3A3D43';
  return (
    <View
      accessible={false}
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      <ThemedText style={[styles.text, { fontSize: size * 0.38, lineHeight: size * 0.46 }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFFFFF', fontWeight: 800 },
});
