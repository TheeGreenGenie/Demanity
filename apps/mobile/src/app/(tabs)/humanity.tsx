import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BillCard, Section, Tabs } from '@/components/civic';
import { CommunityPosts } from '@/components/community-feed';
import { Button, ErrorText } from '@/components/form';
import { Empty } from '@/components/place-sections';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, community, describeError, type Digest, type GuideSummary } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

type Tab = 'stories' | 'learn' | 'common';
const TABS: readonly { key: Tab; label: string }[] = [
  { key: 'learn', label: 'Learn' },
  { key: 'stories', label: 'Stories' },
  { key: 'common', label: 'Common ground' },
];

type IconName = ComponentProps<typeof Ionicons>['name'];
const TOPICS: Record<string, { label: string; icon: IconName; color: string }> = {
  civics: { label: 'How government works', icon: 'business', color: Brand.primary },
  voting: { label: 'Voting', icon: 'checkbox', color: Brand.location },
  'cost-of-living': { label: 'Cost of living', icon: 'wallet', color: Brand.like },
  'media-literacy': { label: 'Reading the numbers', icon: 'stats-chart', color: '#06B6D4' },
  community: { label: 'Community', icon: 'people', color: Brand.humanity },
};

/**
 * Humanity (R18): its own tab, never a searchable topic. Three parts:
 * - Learn: short, sourced explainers so people can take part in civic life.
 * - Stories: the good people do for each other (kudos only, no dislikes).
 * - Common ground: bills whose sponsors come from more than one party.
 */
export default function HumanityScreen() {
  const router = useRouter();
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>('learn');
  const write = () =>
    isFullyOnboarded(me)
      ? router.push({ pathname: '/compose', params: { community: 'humanity' } })
      : router.push('/join');

  return (
    <Screen flush fab={tab === 'stories' ? { label: 'Share a story', onPress: write } : undefined}>
      <View style={[styles.hero, { backgroundColor: Brand.humanity }]}>
        <Ionicons name="heart" size={140} color="rgba(255,255,255,0.18)" style={styles.heroArt} />
        <ThemedText style={styles.heroTitle}>Humanity</ThemedText>
        <ThemedText style={styles.heroText}>
          Learn how things work, see democracy working, and notice the ways we’re alike.
        </ThemedText>
      </View>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'learn' ? <Learn /> : null}
      {tab === 'stories' ? (
        <View>
          <View style={styles.pad}>
            <ThemedText type="small" themeColor="textSecondary">
              Good news from real people. Kudos only, no dislikes.
            </ThemedText>
          </View>
          <CommunityPosts slug="humanity" onWrite={write} />
        </View>
      ) : null}
      {tab === 'common' ? <CommonGround /> : null}
    </Screen>
  );
}

function Learn() {
  const router = useRouter();
  const theme = useTheme();
  const [guides, setGuides] = useState<GuideSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    civic
      .guides()
      .then((r) => setGuides(r.guides))
      .catch((err) => setError(describeError(err)));
  }, []);
  return (
    <View>
      <Section title="Guides" caption="Short explainers. Every fact links to an official source." />
      <ErrorText message={error} />
      <View style={styles.grid}>
        {(guides ?? []).map((g) => {
          const t = TOPICS[g.topic] ?? TOPICS.civics!;
          return (
            <Pressable
              key={g.slug}
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/guide/[slug]', params: { slug: g.slug } })}
              style={({ pressed }) => [
                styles.guide,
                { backgroundColor: theme.backgroundElement },
                pressed && { opacity: 0.8 },
              ]}
            >
              <View style={[styles.guideIcon, { backgroundColor: t.color }]}>
                <Ionicons name={t.icon} size={20} color="#fff" />
              </View>
              <ThemedText type="caption" style={{ color: t.color, fontWeight: 800 }}>
                {t.label.toUpperCase()}
              </ThemedText>
              <ThemedText type="headline">{g.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {g.summary}
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {g.readingMinutes} min read
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function CommonGround() {
  const router = useRouter();
  const [digest, setDigest] = useState<Digest | null>(null);
  useEffect(() => {
    community
      .digest()
      .then(setDigest)
      .catch(() => undefined);
  }, []);
  if (!digest) return null;
  return (
    <View>
      <Section
        title="This week’s Common Ground"
        caption={`${digest.from} to ${digest.to} · ${digest.note}`}
      />
      <Section
        title="Working together"
        caption="Bills sponsored across party lines, with action this week"
      />
      {digest.bills.length === 0 ? <Empty text="No cross-party bill activity this week." /> : null}
      {digest.bills.map((b) => (
        <BillCard key={b.id} bill={b} />
      ))}
      <Section
        title="Most appreciated stories"
        caption="Humanity posts with the most kudos this week"
      />
      {digest.stories.length === 0 ? <Empty text="No stories this week yet." /> : null}
      {digest.stories.map((s) => (
        <Button
          key={s.id}
          title={`${s.title} · ${s.kudos} kudos`}
          variant="ghost"
          onPress={() => router.push({ pathname: '/post/[id]', params: { id: s.id } })}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  hero: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
    overflow: 'hidden',
  },
  heroArt: { position: 'absolute', right: -20, top: -10 },
  heroTitle: { fontSize: 40, lineHeight: 44, fontWeight: 900, color: '#000' },
  heroText: { fontSize: 16, lineHeight: 22, color: '#1a1200', fontWeight: 600, maxWidth: 420 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  guide: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    gap: Spacing.one + 2,
  },
  guideIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
});
