import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const STEPS = ['Username', 'Identity', 'Email', 'Passkey'] as const;

/** Sign-up progress: which of the four steps you're on. */
export function SignUpSteps({ current }: { current: 0 | 1 | 2 | 3 }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Sign-up progress"
      accessibilityValue={{
        min: 1,
        max: STEPS.length,
        now: current + 1,
        text: `Step ${current + 1} of ${STEPS.length}: ${STEPS[current]}`,
      }}
      style={styles.wrap}
    >
      <View style={styles.bars}>
        {STEPS.map((s, i) => (
          <View
            key={s}
            style={[
              styles.bar,
              { backgroundColor: i <= current ? Brand.primary : theme.backgroundSelected },
            ]}
          />
        ))}
      </View>
      <ThemedText type="caption" themeColor="textSecondary">
        Step {current + 1} of {STEPS.length} · {STEPS[current]}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  bars: { flexDirection: 'row', gap: Spacing.one + 2 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
});
