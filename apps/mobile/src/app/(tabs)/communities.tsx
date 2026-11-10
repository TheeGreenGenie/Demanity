import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { CommunityIcon } from '@/components/forum';
import { Screen } from '@/components/screen';
import { FollowButton } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError, social, type Community } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const SECTIONS: { kind: Community['kind']; title: string; blurb: string }[] = [
  { kind: 'humanity', title: 'Humanity', blurb: 'Kudos only, no dislikes.' },
  { kind: 'location', title: 'Places', blurb: 'The country and the MVP states.' },
  { kind: 'topic', title: 'Topics', blurb: 'The 32 official policy areas used by Congress.' },
];

export default function CommunitiesScreen() {
  const router = useRouter();
  const theme = useTheme();
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
      flush
      title="Explore"
      subtitle="Find communities to follow. Topics map to real legislation."
    >
      <ErrorText message={error} />
      {SECTIONS.map((section) => (
        <View key={section.kind}>
          <View style={[styles.sectionHead, { borderBottomColor: theme.backgroundSelected }]}>
            <ThemedText type="headline">{section.title}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {section.blurb}
            </ThemedText>
          </View>
          {communities
            .filter((c) => c.kind === section.kind)
            .map((c) => (
              <View
                key={c.slug}
                style={[styles.row, { borderBottomColor: theme.backgroundSelected }]}
              >
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={c.name}
                  onPress={() => router.push({ pathname: '/c/[slug]', params: { slug: c.slug } })}
                  style={({ pressed }) => [styles.rowLink, pressed && { opacity: 0.7 }]}
                >
                  <CommunityIcon kind={c.kind} size={40} />
                  <View style={styles.rowText}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {c.name}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {c.followers} {c.followers === 1 ? 'follower' : 'followers'}
                    </ThemedText>
                  </View>
                </Pressable>
                <FollowButton kind="community" name={c.slug} following={c.following} />
              </View>
            ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHead: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowText: { flex: 1, gap: 2 },
});
