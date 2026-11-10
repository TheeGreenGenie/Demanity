import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { FollowButton, PostCard } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError, social, type Profile } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Public profile: only the username, join month and posts are ever shown. */
export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const theme = useTheme();
  const { token, me } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    social
      .user(token, username)
      .then(setProfile)
      .catch((err) => setError(describeError(err)));
  }, [token, username]);

  if (!profile) {
    return (
      <Screen>
        <ErrorText message={error} />
      </Screen>
    );
  }
  const joined = new Date(`${profile.joined}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <Screen flush>
      <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]} />
      <View style={[styles.header, { borderBottomColor: theme.backgroundSelected }]}>
        <View style={styles.topRow}>
          <View style={[styles.avatarRing, { borderColor: theme.background }]}>
            <Avatar name={profile.username} size={84} />
          </View>
          {me?.username !== profile.username ? (
            <FollowButton kind="user" name={profile.username} following={profile.following} />
          ) : null}
        </View>
        <ThemedText type="subtitle">{profile.username}</ThemedText>
        <View style={styles.badges}>
          <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
            ✓ Verified member
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            · Joined {joined}
          </ThemedText>
        </View>
        <ThemedText type="small">
          <ThemedText type="smallBold">{profile.followers}</ThemedText>{' '}
          <ThemedText type="small" themeColor="textSecondary">
            {profile.followers === 1 ? 'follower' : 'followers'}
          </ThemedText>
        </ThemedText>
      </View>
      {profile.posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {profile.posts.length === 0 ? (
        <View style={styles.empty}>
          <ThemedText themeColor="textSecondary">No posts yet.</ThemedText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { height: 150 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.one + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  avatarRing: { marginTop: -42, borderWidth: 4, borderRadius: 50 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  empty: { padding: Spacing.four },
});
