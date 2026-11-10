import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { CommunityIcon, ForumPostCard } from '@/components/forum';
import { Screen } from '@/components/screen';
import { communityColor, FollowButton } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { usePagedPosts } from '@/hooks/use-paged-posts';
import { useTheme } from '@/hooks/use-theme';
import { social, type Community } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

/**
 * A community page in the forum style: colored banner, icon, name, follower
 * count and follow button, a sort bar, then card-style posts.
 */
export function CommunityFeed({ slug, intro }: { slug: string; intro?: string }) {
  const router = useRouter();
  const theme = useTheme();
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

  const color = community ? communityColor(community.kind as Community['kind']) : Brand.primary;
  const write = () =>
    isFullyOnboarded(me)
      ? router.push({ pathname: '/compose', params: { community: slug } })
      : router.push('/join');

  return (
    <Screen flush fab={{ label: 'Write a post', onPress: write }}>
      <View style={[styles.banner, { backgroundColor: color }]} />
      <View style={styles.header}>
        <View style={[styles.iconRing, { borderColor: theme.background }]}>
          {community ? <CommunityIcon kind={community.kind} size={64} /> : null}
        </View>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <ThemedText type="subtitle" numberOfLines={2}>
              {community?.name ?? ''}
            </ThemedText>
            {community ? (
              <ThemedText type="caption" themeColor="textSecondary">
                {community.followers} {community.followers === 1 ? 'follower' : 'followers'} ·{' '}
                {community.kind === 'location'
                  ? 'Place'
                  : community.kind === 'humanity'
                    ? 'Kudos only'
                    : 'Topic'}
              </ThemedText>
            ) : null}
          </View>
          {community ? (
            <FollowButton kind="community" name={slug} following={community.following} />
          ) : null}
        </View>
        {intro || community?.description ? (
          <ThemedText themeColor="textSecondary">{intro ?? community?.description}</ThemedText>
        ) : null}
      </View>

      <View style={[styles.sortBar, { borderBottomColor: theme.backgroundSelected }]}>
        <View style={[styles.sortChip, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="caption" style={styles.sortText}>
            New
          </ThemedText>
        </View>
        <ThemedText type="caption" themeColor="textSecondary">
          Newest first, no hidden ranking
        </ThemedText>
      </View>

      <ErrorText message={posts.error} />
      {posts.posts.map((p) => (
        <ForumPostCard key={p.id} post={p} showCommunity={false} />
      ))}
      {!posts.loading && posts.posts.length === 0 ? (
        <View style={styles.empty}>
          <ThemedText type="headline">No posts yet</ThemedText>
          <ThemedText themeColor="textSecondary">Start the conversation.</ThemedText>
          <Button
            title={isFullyOnboarded(me) ? 'Write the first post' : 'Join to post'}
            onPress={write}
          />
        </View>
      ) : null}
      {posts.hasMore ? (
        <View style={styles.more}>
          <Button
            title="Load more"
            variant="secondary"
            onPress={posts.loadMore}
            busy={posts.loading}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { height: 140, opacity: 0.9 },
  header: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.three },
  iconRing: { marginTop: -36, borderWidth: 4, borderRadius: 40, alignSelf: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  titleText: { flex: 1, gap: 2 },
  sortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortChip: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  sortText: { fontWeight: 800 },
  empty: { padding: Spacing.four, gap: Spacing.two, alignItems: 'flex-start' },
  more: { padding: Spacing.three },
});
