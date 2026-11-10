import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  BillCard,
  LeaderRow,
  OverallCard,
  peerWord,
  SampleBanner,
  ScoreList,
  Section,
  StatGrid,
} from '@/components/civic';
import { ErrorText } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError, type Place, type Scores } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export type PlaceTab = 'overview' | 'scores' | 'living' | 'leaders';
export const PLACE_TABS: readonly { key: PlaceTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'scores', label: 'Scores' },
  { key: 'living', label: 'Cost of living' },
  { key: 'leaders', label: 'Leaders' },
];

export function usePlace(slug: string | null | undefined) {
  const { token } = useAuth();
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    civic
      .place(token, slug)
      .then((p) => !cancelled && setPlace(p))
      .catch((err) => !cancelled && setError(describeError(err)));
    return () => {
      cancelled = true;
    };
  }, [slug, token]);
  return { place, error };
}

function useScores(load: () => Promise<Scores>, key: string) {
  const [scores, setScores] = useState<Scores | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    load()
      .then((s) => !cancelled && setScores(s))
      .catch((err) => !cancelled && setError(describeError(err)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the request
  }, [key]);
  return { scores, error };
}

/** The 32 category scores for a place or a leader. */
export function ScoresTab({ kind, slug }: { kind: 'place' | 'leader'; slug: string }) {
  const { token } = useAuth();
  const { scores, error } = useScores(
    () => (kind === 'place' ? civic.placeScores(token, slug) : civic.leaderScores(token, slug)),
    `${kind}:${slug}:${token}`,
  );
  if (error) return <ErrorText message={error} />;
  if (!scores) return null;
  const sample = scores.categories.some((c) => c.isSample);
  return (
    <View>
      {sample ? <SampleBanner what="these scores and explanations are made up" /> : null}
      <OverallCard overall={scores.overall} peerKind={scores.peerGroup} />
      <Section
        title="Scores in all 32 categories"
        caption={`0-100, higher is better · compared only with other ${peerWord(scores.peerGroup)}`}
      />
      <ScoreList items={scores.categories} peerKind={scores.peerGroup} />
    </View>
  );
}

export function PlaceTabContent({ place, tab }: { place: Place; tab: PlaceTab }) {
  if (tab === 'scores') return <ScoresTab kind="place" slug={place.slug} />;
  if (tab === 'living') return <LivingTab place={place} />;
  if (tab === 'leaders') return <LeadersTab place={place} />;
  return <OverviewTab place={place} />;
}

const placeHref = (p: { slug: string }) => ({
  pathname: '/place/[slug]' as const,
  params: { slug: p.slug },
});

function OverviewTab({ place }: { place: Place }) {
  const router = useRouter();
  const theme = useTheme();
  const sample =
    place.isSample ||
    place.issues.some((i) => i.isSample) ||
    place.leaders.some((l) => l.isSample) ||
    place.stats.some((s) => s.isSample);
  return (
    <View>
      {sample ? <SampleBanner /> : null}
      <OverallCard overall={place.overall} peerKind={place.kind} />

      <Section title="Most pressing issues" caption="Where this place scores worst vs. its peers">
        {place.issues.length === 0 ? (
          <Empty text="No issue data yet. It arrives with official statistics." />
        ) : (
          place.issues.map((i) => (
            <Pressable
              key={i.rank}
              accessibilityRole="link"
              onPress={() =>
                i.categorySlug &&
                router.push({ pathname: '/c/[slug]', params: { slug: i.categorySlug } })
              }
              style={({ pressed }) => [
                styles.issue,
                { backgroundColor: theme.backgroundElement },
                pressed && { opacity: 0.75 },
              ]}
            >
              <ThemedText style={styles.issueRank}>{i.rank}</ThemedText>
              <View style={styles.flex}>
                <ThemedText type="smallBold">{i.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {i.summary}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {i.sourceLabel}
                </ThemedText>
              </View>
            </Pressable>
          ))
        )}
      </Section>

      <Section title="Upcoming elections">
        {place.elections.length === 0 ? (
          <Empty text="No upcoming elections listed yet." />
        ) : (
          place.elections.map((e, idx) => {
            const d = new Date(`${e.electionDate}T12:00:00Z`);
            return (
              <View
                key={idx}
                style={[styles.election, { borderBottomColor: theme.backgroundSelected }]}
              >
                <View style={[styles.date, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
                    {d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()}
                  </ThemedText>
                  <ThemedText style={styles.dateDay}>{d.getUTCDate()}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {d.getUTCFullYear()}
                  </ThemedText>
                </View>
                <View style={styles.flex}>
                  <ThemedText type="smallBold">{e.office}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {e.kind[0]!.toUpperCase() + e.kind.slice(1)} election · {e.sourceLabel}
                  </ThemedText>
                </View>
              </View>
            );
          })
        )}
      </Section>

      <Section title="Current leaders" caption="Overall trust score, 0-100">
        {place.leaders.length === 0 ? (
          <Empty text="No leaders listed for this place yet." />
        ) : (
          place.leaders.slice(0, 4).map((l) => <LeaderRow key={l.slug} leader={l} />)
        )}
      </Section>

      <Section title="Recent legislation">
        {place.recentBills.length === 0 ? (
          <Empty text="No bills yet. Legislation tracking arrives with data ingestion." />
        ) : (
          place.recentBills.map((b) => <BillCard key={b.id} bill={b} />)
        )}
      </Section>

      {place.children.length > 0 ? (
        <Section title={`Places in ${place.name}`}>
          <View style={styles.children}>
            {place.children.map((c) => (
              <Pressable
                key={c.slug}
                accessibilityRole="link"
                onPress={() => router.push(placeHref(c))}
                style={({ pressed }) => [
                  styles.childChip,
                  { backgroundColor: theme.backgroundElement },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Ionicons name="location-outline" size={14} color={Brand.location} />
                <ThemedText type="caption" style={{ fontWeight: 700 }}>
                  {c.name}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {peerWord(c.kind, false)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}
      {place.parent ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push(placeHref(place.parent!))}
          style={styles.parent}
        >
          <ThemedText type="small" style={{ color: Brand.primary, fontWeight: 700 }}>
            Part of {place.parent.name} →
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function LivingTab({ place }: { place: Place }) {
  return (
    <View>
      {place.stats.some((s) => s.isSample) ? (
        <SampleBanner what="these statistics are made up" />
      ) : null}
      <Section
        title="Cost and quality of life"
        caption={`Compared with the median of other ${peerWord(place.kind)}`}
      />
      {place.stats.length === 0 ? (
        <Empty text="No statistics yet for this kind of place." />
      ) : (
        <StatGrid stats={place.stats} peerKind={place.kind} />
      )}
      <View style={styles.note}>
        <ThemedText type="caption" themeColor="textSecondary">
          Green means better for residents than the typical {peerWord(place.kind, false)}, orange
          means worse. Each figure lists its source and year.
        </ThemedText>
      </View>
    </View>
  );
}

function LeadersTab({ place }: { place: Place }) {
  return (
    <View>
      {place.leaders.some((l) => l.isSample) ? (
        <SampleBanner what="these leaders are fictional people and their scores are made up" />
      ) : null}
      <Section title={`Leaders for ${place.name}`} caption="Tap a leader for their full record" />
      {place.leaders.length === 0 ? (
        <Empty text="No leaders listed yet." />
      ) : (
        place.leaders.map((l) => <LeaderRow key={l.slug} leader={l} />)
      )}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <ThemedText type="small" themeColor="textSecondary">
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  issue: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    padding: Spacing.three - 4,
    borderRadius: Radius.medium,
  },
  issueRank: { fontSize: 26, lineHeight: 30, fontWeight: 900, color: Brand.dislike, width: 22 },
  election: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  date: { width: 56, alignItems: 'center', borderRadius: Radius.small, paddingVertical: 4 },
  dateDay: { fontSize: 22, lineHeight: 26, fontWeight: 900 },
  children: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  childChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.one + 2,
  },
  parent: { padding: Spacing.three },
  note: { padding: Spacing.three },
  empty: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
