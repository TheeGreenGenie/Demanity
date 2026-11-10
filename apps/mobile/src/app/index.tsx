import { ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

// Placeholder home screen for the MVP shell. Each pillar becomes a real
// route as its phase is built (see docs/VISION.md, Development roadmap).
const PILLARS = [
  { title: 'Legislation', body: 'Every new federal and state bill, order, regulation and ruling.' },
  { title: 'Leaders', body: 'Trust pages that hold leaders to their own stated positions.' },
  { title: 'Polls', body: 'One verified person, one unlinkable vote.' },
  { title: 'Forums', body: 'Discuss issues by topic, location and bill.' },
  { title: 'Humanity', body: 'The good people do for each other, and the ways we are alike.' },
] as const;

export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">Demanity</ThemedText>
        <ThemedText themeColor="textSecondary">Democracy + Humanity</ThemedText>

        {PILLARS.map((pillar) => (
          <ThemedView key={pillar.title} type="backgroundElement" style={styles.card}>
            <ThemedText type="subtitle">{pillar.title}</ThemedText>
            <ThemedText>{pillar.body}</ThemedText>
          </ThemedView>
        ))}

        <ThemedText type="small" themeColor="textSecondary">
          Pre-release build. Browsing as a guest: nothing about you is tracked.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: 12,
  },
});
