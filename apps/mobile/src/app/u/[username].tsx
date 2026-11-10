import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { FollowButton, PostCard } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { describeError, social, type Profile } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Public profile: only the username, join month and posts are ever shown. */
export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
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

  return (
    <Screen title={`@${profile.username}`} subtitle={`Verified member since ${profile.joined}`}>
      <View style={styles.header}>
        {me?.username !== profile.username ? (
          <FollowButton kind="user" name={profile.username} following={profile.following} />
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          {profile.followers} {profile.followers === 1 ? 'follower' : 'followers'}
        </ThemedText>
      </View>
      {profile.posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {profile.posts.length === 0 ? (
        <ThemedText themeColor="textSecondary">No posts yet.</ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
