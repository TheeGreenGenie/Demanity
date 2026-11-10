import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

export default function AccountScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { ready, token, me, signOut } = useAuth();
  if (!ready) return null;

  if (!isFullyOnboarded(me)) {
    return (
      <Screen
        title="Your account"
        subtitle="Browse freely as a guest. To post, comment, react or vote, join with one verified account per person."
      >
        {token ? (
          <Button title="Continue signing up" onPress={() => router.push('/onboarding')} />
        ) : (
          <>
            <Button title="Join Demanity" onPress={() => router.push('/join')} />
            <Button title="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} />
          </>
        )}
      </Screen>
    );
  }

  const checks = ['Identity verified', 'Email confirmed', 'Passkey sign-in'];
  return (
    <Screen>
      <View style={styles.head}>
        <Avatar name={me!.username} size={72} />
        <View style={styles.headText}>
          <ThemedText type="subtitle">{me!.username}</ThemedText>
          <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
            Verified Demanity member
          </ThemedText>
        </View>
      </View>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        {checks.map((c) => (
          <ThemedText key={c} type="small">
            <ThemedText type="small" style={{ color: Brand.like, fontWeight: 900 }}>
              ✓{' '}
            </ThemedText>
            {c}
          </ThemedText>
        ))}
      </View>
      <Button
        title="View your public profile"
        variant="secondary"
        onPress={() =>
          router.push({ pathname: '/u/[username]', params: { username: me!.username } })
        }
      />
      <Button
        title="Sign out"
        variant="ghost"
        onPress={async () => {
          await signOut();
          router.replace('/');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  headText: { flex: 1, gap: 2 },
  card: { borderRadius: Radius.large, padding: Spacing.three, gap: Spacing.two },
});
