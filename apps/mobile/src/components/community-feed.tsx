import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { FollowButton, PostCard } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePagedPosts } from '@/hooks/use-paged-posts';
import { social, type Community } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

/** A community's header, follow button, compose action and newest-first posts. */
export function CommunityFeed({ slug, intro }: { slug: string; intro?: string }) {
  const router = useRouter();
  const { token, me } = useAuth();
  const [community, setCommunity] = useState<Community | null>(null);
  const posts = usePagedPosts(
    (cursor) => social.communityPosts(token, slug, cursor),
    `${slug}:${token}`,
  );

  useEffect(() => {
    social
      .community(token, slug)
      .then(setCommunity)
      .catch(() => setCommunity(null));
  }, [token, slug]);

  return (
    <Screen title={community?.name ?? ''} subtitle={intro ?? (community?.description || undefined)}>
      {community ? (
        <View style={styles.header}>
          <FollowButton kind="community" name={slug} following={community.following} />
          <ThemedText type="small" themeColor="textSecondary">
            {community.followers} {community.followers === 1 ? 'follower' : 'followers'}
          </ThemedText>
        </View>
      ) : null}
      <Button
        title={isFullyOnboarded(me) ? 'Write a post' : 'Join to post'}
        variant="secondary"
        onPress={() =>
          isFullyOnboarded(me)
            ? router.push({ pathname: '/compose', params: { community: slug } })
            : router.push('/join')
        }
      />
      <ErrorText message={posts.error} />
      {posts.posts.map((p) => (
        <PostCard key={p.id} post={p} showCommunity={false} />
      ))}
      {!posts.loading && posts.posts.length === 0 ? (
        <ThemedText themeColor="textSecondary">No posts yet. Start the conversation.</ThemedText>
      ) : null}
      {posts.hasMore ? (
        <Button
          title="Load more"
          variant="secondary"
          onPress={posts.loadMore}
          busy={posts.loading}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
