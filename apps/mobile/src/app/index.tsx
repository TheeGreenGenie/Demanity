import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

// Each pillar becomes a real route as its phase is built (docs/VISION.md roadmap).
const PILLARS = [
  { title: 'Legislation', body: 'Every new federal and state bill, order, regulation and ruling.' },
  { title: 'Leaders', body: 'Trust pages that hold leaders to their own stated positions.' },
  { title: 'Polls', body: 'One verified person, one unlinkable vote.' },
  { title: 'Forums', body: 'Discuss issues by topic, location and bill.' },
  { title: 'Humanity', body: 'The good people do for each other, and the ways we are alike.' },
] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { ready, token, me } = useAuth();

  return (
    <Screen>
      <ThemedText type="title">Demanity</ThemedText>
      <ThemedText themeColor="textSecondary">Democracy + Humanity</ThemedText>

      {ready && isFullyOnboarded(me) ? (
        <Button
          title={`Signed in as ${me!.username}`}
          variant="secondary"
          onPress={() => router.push('/account')}
        />
      ) : ready && token ? (
        <Button title="Continue signing up" onPress={() => router.push('/onboarding')} />
      ) : ready ? (
        <ThemedView style={styles.actions}>
          <Button title="Join Demanity" onPress={() => router.push('/join')} />
          <Button title="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} />
        </ThemedView>
      ) : null}

      {PILLARS.map((pillar) => (
        <ThemedView key={pillar.title} type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">{pillar.title}</ThemedText>
          <ThemedText>{pillar.body}</ThemedText>
        </ThemedView>
      ))}

      <ThemedText type="small" themeColor="textSecondary">
        Pre-release build. Browsing as a guest: nothing about you is tracked.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: Spacing.two },
  card: { gap: Spacing.two, padding: Spacing.three, borderRadius: 12 },
});
