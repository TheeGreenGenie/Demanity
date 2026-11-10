import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { describeError, social, type Community } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const SECTIONS: { kind: Community['kind']; title: string }[] = [
  { kind: 'location', title: 'Places' },
  { kind: 'topic', title: 'Topics' },
];

export default function CommunitiesScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    social
      .communities(token)
      .then((r) => setCommunities(r.communities))
      .catch((err) => setError(describeError(err)));
  }, [token]);

  return (
    <Screen
      title="Communities"
      subtitle="Topics follow the 32 official policy areas used by Congress, so discussion maps to real legislation."
    >
      <ErrorText message={error} />
      {SECTIONS.map((section) => (
        <ThemedView key={section.kind} style={styles.section}>
          <ThemedText type="smallBold">{section.title}</ThemedText>
          {communities
            .filter((c) => c.kind === section.kind)
            .map((c) => (
              <Pressable
                key={c.slug}
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/c/[slug]', params: { slug: c.slug } })}
              >
                <ThemedView type="backgroundElement" style={styles.row}>
                  <ThemedText>{c.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {c.following ? 'Following · ' : ''}
                    {c.followers} {c.followers === 1 ? 'follower' : 'followers'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            ))}
        </ThemedView>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  row: {
    borderRadius: Radius.medium,
    padding: Spacing.three,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
