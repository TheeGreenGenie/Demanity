import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';

/**
 * Standard screen: a centered column (like large social apps on wide screens),
 * optional bold title/subtitle, and an optional floating action button.
 * `flush` removes side padding so feeds can run edge to edge.
 */
export function Screen({
  title,
  subtitle,
  children,
  flush = false,
  fab,
}: {
  title?: string;
  subtitle?: string | undefined;
  children?: ReactNode;
  flush?: boolean;
  fab?: { label: string; icon?: 'create-outline' | 'add'; onPress: () => void };
}) {
  return (
    <ThemedView style={styles.fill}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, flush && styles.flush]}
          keyboardShouldPersistTaps="handled"
        >
          {title || subtitle ? (
            <View style={[styles.heading, flush && styles.headingFlush]}>
              {title ? <ThemedText type="subtitle">{title}</ThemedText> : null}
              {subtitle ? <ThemedText themeColor="textSecondary">{subtitle}</ThemedText> : null}
            </View>
          ) : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
      {fab ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fab.label}
          onPress={fab.onPress}
          style={({ pressed }) => [
            styles.fab,
            pressed && { backgroundColor: Brand.primaryPressed },
          ]}
        >
          <Ionicons name={fab.icon ?? 'create-outline'} size={26} color={Brand.onPrimary} />
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    gap: Spacing.three,
    padding: Spacing.three,
    paddingBottom: Spacing.six + Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  flush: { paddingHorizontal: 0, paddingTop: 0, gap: 0 },
  heading: { gap: Spacing.one },
  headingFlush: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  fab: {
    position: 'absolute',
    right: Spacing.four,
    bottom: Spacing.four,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
