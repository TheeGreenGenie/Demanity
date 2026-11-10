import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Filled text input with a label, hint, inline error and an accent focus ring. */
export function Field({
  label,
  hint,
  error,
  onFocus,
  onBlur,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | undefined }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const border = error ? Brand.danger : focused ? Brand.primary : theme.backgroundSelected;
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={theme.textSecondary}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          input.multiline && styles.multiline,
          { color: theme.text, borderColor: border, backgroundColor: theme.backgroundElement },
        ]}
        {...input}
      />
      {error ? (
        <ThemedText type="small" accessibilityRole="alert" style={styles.error}>
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Pill button. primary = solid accent, secondary = outline, ghost = text only. */
export function Button({
  title,
  onPress,
  busy = false,
  disabled = false,
  variant = 'primary',
  size = 'large',
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'large' | 'small';
}) {
  const theme = useTheme();
  const inactive = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === 'small' && styles.small,
        variant === 'primary' && {
          backgroundColor: pressed ? Brand.primaryPressed : Brand.primary,
        },
        variant === 'secondary' && {
          borderWidth: 1,
          borderColor: theme.backgroundSelected,
          backgroundColor: pressed ? theme.backgroundElement : 'transparent',
        },
        variant === 'ghost' && {
          backgroundColor: pressed ? theme.backgroundElement : 'transparent',
        },
        inactive && { opacity: 0.5 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? Brand.onPrimary : theme.text} />
      ) : (
        <ThemedText
          type="smallBold"
          style={[
            size === 'large' && styles.largeLabel,
            variant === 'primary' && { color: Brand.onPrimary },
            variant === 'ghost' && { color: Brand.primary },
          ]}
        >
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <ThemedText type="small" accessibilityRole="alert" style={styles.error}>
      {message}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one + 2 },
  input: {
    borderWidth: 1.5,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
    fontSize: Type.default.fontSize,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  button: {
    borderRadius: Radius.pill,
    paddingVertical: Spacing.three - 2,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  small: { minHeight: 34, paddingVertical: Spacing.one + 2, paddingHorizontal: Spacing.three },
  largeLabel: { fontSize: 16, fontWeight: 800 },
  error: { color: Brand.danger, fontWeight: 600 },
});
