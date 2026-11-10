import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BillCard, Chips, Section, Tabs } from '@/components/civic';
import { Button, ErrorText } from '@/components/form';
import { CommunityIcon, ForumPostCard } from '@/components/forum';
import {
  Empty,
  PLACE_TABS,
  PlaceTabContent,
  usePlace,
  type PlaceTab,
} from '@/components/place-sections';
import { Screen } from '@/components/screen';
import { communityColor, FollowButton } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { usePagedPosts } from '@/hooks/use-paged-posts';
import { useTheme } from '@/hooks/use-theme';
import { civic, social, type Bill, type Community, type PostSort } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

type Tab = 'posts' | 'bills' | 'about' | PlaceTab;

const SORTS = [
  { key: 'hot', label: 'Hot', icon: 'flame-outline' },
  { key: 'new', label: 'New', icon: 'sparkles-outline' },
  { key: 'top', label: 'Top', icon: 'trending-up' },
] as const;

const SORT_HELP: Record<PostSort, string> = {
  new: 'Newest first, no ranking.',
  hot: 'Votes divided by age, so newer posts with votes rise. Formula is public.',
  top: 'Most net votes (likes − dislikes + kudos) first.',
};

/** Community rules shown on every community's About tab (docs/MODERATION.md). */
export const COMMUNITY_RULES = [
  ['Debate ideas, not people', 'Disagree as hard as you like; personal attacks are removed.'],
  ['Cite facts', 'Factual claims need a source from the approved list. Opinions are welcome.'],
  ['No hate or harassment', 'Hate based on race, gender or religion, and harassment, are removed.'],
  ['Context over removal', 'Misleading posts usually get a context note instead of removal.'],
  ['Every removal is public', 'Moderator actions appear in the public moderation log.'],
] as const;

/** Posts with Hot / New / Top sorting (Reddit-style). */
export function CommunityPosts({ slug, onWrite }: { slug: string; onWrite: () => void }) {
  const theme = useTheme();
  const { token, me } = useAuth();
  const [sort, setSort] = useState<PostSort>('new');
  const posts = usePagedPosts(
    (cursor) => social.communityPosts(token, slug, cursor, sort),
    `${slug}:${sort}:${token}`,
  );
  return (
    <View>
      <View style={[styles.sortBar, { borderBottomColor: theme.backgroundSelected }]}>
        <Chips label="Sort posts" options={SORTS} value={sort} onChange={setSort} />
        <ThemedText type="caption" themeColor="textSecondary">
          {SORT_HELP[sort]}
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
            onPress={onWrite}
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
    </View>
  );
}

function BillsTab({ category }: { category: string }) {
  const { token } = useAuth();
  const [bills, setBills] = useState<Bill[] | null>(null);
  useEffect(() => {
    civic
      .bills(token, { category })
      .then((r) => setBills(r.bills))
      .catch(() => setBills([]));
  }, [token, category]);
  if (!bills) return null;
  return (
    <View>
      <Section title="Legislation in this topic" caption="Newest action first" />
      {bills.length === 0 ? (
        <Empty text="No bills in this topic yet." />
      ) : (
        bills.map((b) => <BillCard key={b.id} bill={b} />)
      )}
    </View>
  );
}

export function AboutTab({ community }: { community: Community }) {
  const theme = useTheme();
  return (
    <View>
      <Section title={`About c/${community.slug}`}>
        <View style={styles.aboutBody}>
          <ThemedText themeColor="textSecondary">
            {community.description ||
              (community.kind === 'topic'
                ? `Discussion about ${community.name}, one of the 32 policy areas Congress uses to classify legislation.`
                : `Discussion about ${community.name}.`)}
          </ThemedText>
          <View style={styles.aboutStats}>
            <View>
              <ThemedText type="headline">{community.followers}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                Members
              </ThemedText>
            </View>
            <View>
              <ThemedText type="headline">{community.posts ?? 0}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                Posts
              </ThemedText>
            </View>
          </View>
        </View>
      </Section>
      <Section title="Rules">
        {COMMUNITY_RULES.map(([title, body], i) => (
          <View key={title} style={[styles.rule, { borderBottomColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold">
              {i + 1}. {title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {body}
            </ThemedText>
          </View>
        ))}
      </Section>
    </View>
  );
}

/**
 * A community page in the Reddit style: colored banner, icon, c/name, member
 * count and Join button, a tab bar, then the tab's content. Place communities
 * (states, the nation) get place tabs: overview, scores, cost of living and
 * leaders. Topic communities get a Bills tab.
 */
export function CommunityFeed({ slug, initialTab }: { slug: string; initialTab?: string }) {
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const [community, setCommunity] = useState<Community | null>(null);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? 'posts');
  const { place, error: placeError } = usePlace(community?.place);

  useEffect(() => {
    social
      .community(token, slug)
      .then(setCommunity)
      .catch(() => setCommunity(null));
  }, [token, slug]);

  const color = community ? communityColor(community.kind) : Brand.primary;
  const write = () =>
    isFullyOnboarded(me)
      ? router.push({ pathname: '/compose', params: { community: slug } })
      : router.push('/join');

  const tabs: readonly { key: Tab; label: string }[] = [
    { key: 'posts', label: 'Posts' },
    ...(community?.place ? PLACE_TABS : []),
    ...(community?.kind === 'topic' ? [{ key: 'bills' as const, label: 'Bills' }] : []),
    { key: 'about', label: 'About' },
  ];

  return (
    <Screen flush fab={tab === 'posts' ? { label: 'Write a post', onPress: write } : undefined}>
      <View style={[styles.banner, { backgroundColor: color }]}>
        <Ionicons
          name={community?.kind === 'location' ? 'map' : 'chatbubbles'}
          size={120}
          color="rgba(255,255,255,0.12)"
          style={styles.bannerArt}
        />
      </View>
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
                c/{community.slug} · {community.followers}{' '}
                {community.followers === 1 ? 'member' : 'members'}
              </ThemedText>
            ) : null}
          </View>
          {community ? (
            <FollowButton kind="community" name={slug} following={community.following} />
          ) : null}
        </View>
      </View>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'posts' ? <CommunityPosts slug={slug} onWrite={write} /> : null}
      {tab === 'bills' ? <BillsTab category={slug} /> : null}
      {tab === 'about' && community ? <AboutTab community={community} /> : null}
      {tab !== 'posts' && tab !== 'bills' && tab !== 'about' ? (
        place ? (
          <PlaceTabContent place={place} tab={tab} />
        ) : (
          <ErrorText message={placeError} />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { height: 140, overflow: 'hidden' },
  bannerArt: { position: 'absolute', right: -10, bottom: -24 },
  header: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.two },
  iconRing: { marginTop: -36, borderWidth: 4, borderRadius: 40, alignSelf: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  titleText: { flex: 1, gap: 2 },
  sortBar: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { padding: Spacing.four, gap: Spacing.two, alignItems: 'flex-start' },
  more: { padding: Spacing.three },
  aboutBody: { paddingHorizontal: Spacing.three, gap: Spacing.three },
  aboutStats: { flexDirection: 'row', gap: Spacing.five },
  rule: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.small,
  },
});
