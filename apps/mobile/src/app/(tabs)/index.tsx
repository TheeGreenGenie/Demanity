import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { BillCard } from '@/components/civic';
import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { communityColor, Pill, PillRow, PostCard } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { usePagedPosts } from '@/hooks/use-paged-posts';
import { useTheme } from '@/hooks/use-theme';
import { social, type Bill, type Community, type FollowedItem, type Post } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

export default function HomeScreen() {
  const { ready, me } = useAuth();
  if (!ready) return null;
  return isFullyOnboarded(me) ? <MemberHome /> : <GuestHome />;
}

/** Community pills at the top of the feed: followed ones first. */
function useCommunityPills(token: string | null) {
  const [communities, setCommunities] = useState<Community[]>([]);
  useEffect(() => {
    social
      .communities(token)
      .then((r) =>
        setCommunities(
          r.communities
            .filter((c) => c.kind !== 'humanity') // Humanity has its own tab
            .sort((a, b) => Number(b.following) - Number(a.following))
            .slice(0, 14),
        ),
      )
      .catch(() => undefined);
  }, [token]);
  return communities;
}

/** Members: their feed. Chronological, built only from what they follow; each item says why it's there. */
function MemberHome() {
  const router = useRouter();
  const theme = useTheme();
  const { token } = useAuth();
  const feed = usePagedPosts((cursor) => social.feed(token!, cursor), `feed:${token}`);
  const pills = useCommunityPills(token);

  return (
    <Screen flush fab={{ label: 'Write a post', onPress: () => router.push('/compose') }}>
      <PillRow>
        {pills.map((c) => (
          <Pill
            key={c.slug}
            label={c.name}
            color={communityColor(c.kind)}
            selected={c.following}
            onPress={() => router.push({ pathname: '/c/[slug]', params: { slug: c.slug } })}
          />
        ))}
      </PillRow>
      <View style={[styles.feedHeader, { borderBottomColor: theme.backgroundSelected }]}>
        <ThemedText type="headline">Your feed</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          Newest first · only what you follow · no hidden ranking
        </ThemedText>
      </View>
      <ErrorText message={feed.error} />
      <FollowingRow items={feed.first?.following ?? []} />
      {mergeFeed(feed.posts, feed.first?.updates ?? []).map((item) =>
        item.kind === 'post' ? (
          <PostCard key={item.post.id} post={item.post} />
        ) : (
          <BillCard key={`bill-${item.bill.id}`} bill={item.bill} />
        ),
      )}
      {!feed.loading && feed.posts.length === 0 && !(feed.first?.updates ?? []).length ? (
        <View style={styles.empty}>
          <ThemedText themeColor="textSecondary">
            Nothing here yet. Follow communities, leaders, places or bills to fill your feed.
          </ThemedText>
        </View>
      ) : null}
      {feed.hasMore ? (
        <View style={styles.more}>
          <Button
            title="Load more"
            variant="secondary"
            onPress={feed.loadMore}
            busy={feed.loading}
          />
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * Posts (paged) and bill updates from what you follow (first page only),
 * merged newest first. Both carry a "why you're seeing this" reason.
 */
function mergeFeed(posts: Post[], updates: Bill[]) {
  const items = [
    ...posts.map((post) => ({ kind: 'post' as const, at: post.createdAt, post })),
    ...updates.map((bill) => ({
      kind: 'bill' as const,
      at: `${bill.lastActionAt}T12:00:00Z`,
      bill,
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** Followed leaders, places and bills, like a stories row. */
function FollowingRow({ items }: { items: FollowedItem[] }) {
  const router = useRouter();
  const theme = useTheme();
  if (items.length === 0) return null;
  const open = (i: FollowedItem) =>
    i.kind === 'leader'
      ? router.push({ pathname: '/leader/[slug]', params: { slug: i.id } })
      : i.kind === 'place'
        ? router.push({ pathname: '/place/[slug]', params: { slug: i.id } })
        : router.push({ pathname: '/bill/[id]', params: { id: i.id } });
  return (
    <View style={[styles.followingWrap, { borderBottomColor: theme.backgroundSelected }]}>
      <ThemedText type="caption" themeColor="textSecondary" style={styles.followingTitle}>
        FOLLOWING
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.followingRow}
      >
        {items.map((i) => (
          <Pressable
            key={`${i.kind}:${i.id}`}
            accessibilityRole="link"
            accessibilityLabel={`${i.name}, ${i.caption}`}
            onPress={() => open(i)}
            style={({ pressed }) => [styles.followingItem, pressed && { opacity: 0.7 }]}
          >
            {i.kind === 'leader' ? (
              <Avatar name={i.name} size={56} />
            ) : (
              <View
                style={[
                  styles.followingIcon,
                  { backgroundColor: i.kind === 'place' ? Brand.location : Brand.primary },
                ]}
              >
                <Ionicons
                  name={i.kind === 'place' ? 'location' : 'document-text'}
                  size={26}
                  color="#fff"
                />
              </View>
            )}
            <ThemedText type="caption" numberOfLines={1} style={styles.followingName}>
              {i.name.replace('[Sample] ', '')}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const PILLARS: {
  title: string;
  body: string;
  icon: 'document-text' | 'shield-checkmark' | 'checkbox' | 'chatbubbles' | 'heart';
  color: string;
}[] = [
  {
    title: 'Legislation',
    body: 'Every new federal and state bill, order, regulation and ruling.',
    icon: 'document-text',
    color: Brand.location,
  },
  {
    title: 'Leaders',
    body: 'Trust pages that hold leaders to their own stated positions.',
    icon: 'shield-checkmark',
    color: Brand.primary,
  },
  {
    title: 'Polls',
    body: 'One verified person, one unlinkable vote.',
    icon: 'checkbox',
    color: Brand.like,
  },
  {
    title: 'Forums',
    body: 'Discuss issues by topic, location and bill.',
    icon: 'chatbubbles',
    color: '#EC4899',
  },
  {
    title: 'Humanity',
    body: 'The good people do for each other, and the ways we are alike.',
    icon: 'heart',
    color: Brand.humanity,
  },
];

/** Guests: a bold hero, how to join, what's inside, and a taste of Humanity. */
function GuestHome() {
  const router = useRouter();
  const theme = useTheme();
  const { token } = useAuth();
  const humanity = usePagedPosts(
    (cursor) => social.communityPosts(null, 'humanity', cursor),
    'guest-humanity',
  );

  return (
    <Screen flush>
      <View style={styles.hero}>
        <ThemedText type="caption" style={styles.eyebrow}>
          DEMANITY
        </ThemedText>
        <ThemedText type="title">
          Democracy + Humanity
          <ThemedText type="title" style={{ color: Brand.primary }}>
            .
          </ThemedText>
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.lede}>
          Track what government actually does, hold leaders to their word, and talk it through with
          real, verified people. One person, one account.
        </ThemedText>
        <View style={styles.cta}>
          {token ? (
            <Button title="Continue signing up" onPress={() => router.push('/onboarding')} />
          ) : (
            <>
              <Button title="Join Demanity" onPress={() => router.push('/join')} />
              <Button title="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} />
            </>
          )}
        </View>
      </View>

      <View style={styles.grid}>
        {PILLARS.map((p) => (
          <View key={p.title} style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
            <View style={[styles.tileIcon, { backgroundColor: p.color }]}>
              <Ionicons name={p.icon} size={18} color="#fff" />
            </View>
            <ThemedText type="headline">{p.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {p.body}
            </ThemedText>
          </View>
        ))}
      </View>

      {humanity.posts.length > 0 ? (
        <View style={[styles.feedHeader, { borderBottomColor: theme.backgroundSelected }]}>
          <ThemedText type="headline">Recently in Humanity</ThemedText>
        </View>
      ) : null}
      {humanity.posts.slice(0, 3).map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      <ThemedText type="caption" themeColor="textSecondary" style={styles.footnote}>
        Pre-release build. Browsing as a guest: nothing about you is tracked.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  followingWrap: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two },
  followingTitle: { paddingHorizontal: Spacing.three, fontWeight: 900, letterSpacing: 0.5 },
  followingRow: { paddingHorizontal: Spacing.three, gap: Spacing.three, paddingTop: Spacing.two },
  followingItem: { width: 68, alignItems: 'center', gap: 4 },
  followingIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followingName: { fontWeight: 700, textAlign: 'center' },
  feedHeader: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  empty: { padding: Spacing.four },
  more: { padding: Spacing.three },
  hero: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  eyebrow: { color: Brand.primary, fontWeight: 900, letterSpacing: 3 },
  lede: { fontSize: 18, lineHeight: 26 },
  cta: { gap: Spacing.two, marginTop: Spacing.two },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: Radius.large,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footnote: { padding: Spacing.three },
});
