import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Field({
  label,
  hint,
  ...input
}: TextInputProps & { label: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: theme.backgroundSelected,
            backgroundColor: theme.background,
          },
        ]}
        {...input}
      />
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  busy = false,
  disabled = false,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
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
        variant === 'primary'
          ? { backgroundColor: Brand.primary }
          : {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.backgroundSelected,
              borderWidth: 1,
            },
        (pressed || inactive) && { opacity: 0.6 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? Brand.onPrimary : theme.text} />
      ) : (
        <ThemedText type="smallBold" style={variant === 'primary' ? styles.primaryText : undefined}>
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
  field: { gap: Spacing.one },
  input: {
    borderWidth: 1,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 16,
  },
  button: {
    borderRadius: Radius.small,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryText: { color: Brand.onPrimary },
  error: { color: Brand.danger },
});
