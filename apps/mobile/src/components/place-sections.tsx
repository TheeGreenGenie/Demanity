import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  BillCard,
  formatStat,
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

export type PlaceTab = 'overview' | 'scores' | 'living' | 'leaders';
export const PLACE_TABS: readonly { key: PlaceTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'scores', label: 'Scores' },
  { key: 'living', label: 'Cost of living' },
  { key: 'leaders', label: 'Leaders' },
];

/** Place data is identical for everyone (cached on the server), so no token is sent. */
export function usePlace(slug: string | null | undefined) {
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    civic
      .place(null, slug)
      .then((p) => !cancelled && setPlace(p))
      .catch((err) => !cancelled && setError(describeError(err)));
    return () => {
      cancelled = true;
    };
  }, [slug]);
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

/** Category scores for a place (conditions) or a leader (trust). */
export function ScoresTab({ kind, slug }: { kind: 'place' | 'leader'; slug: string }) {
  const { scores, error } = useScores(
    () => (kind === 'place' ? civic.placeScores(null, slug) : civic.leaderScores(null, slug)),
    `${kind}:${slug}`,
  );
  if (error) return <ErrorText message={error} />;
  if (!scores) return null;
  const sample = scores.categories.some((c) => c.isSample);
  const applicable = scores.categories.filter((c) => c.applicable).length;
  return (
    <View>
      {sample ? <SampleBanner what="these scores and explanations are made up" /> : null}
      <OverallCard overall={scores.overall} />
      <Section
        title={scores.kind === 'conditions' ? 'Conditions by category' : 'Trust by category'}
        caption={`0-100, higher is better · ${applicable} of ${scores.categories.length} categories apply · compared with ${scores.peerLabel}`}
      />
      <ScoreList
        items={scores.categories}
        peerLabel={scores.peerLabel}
        subjectKind={scores.subjectKind}
      />
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
      <OverallCard overall={place.overall} />

      <Section
        title="Most pressing issues"
        caption={`Where conditions are worst vs. ${place.peerLabel}`}
      >
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

      <Section
        title="Upcoming elections"
        caption="Cast a mock ballot, and check that you're registered"
      >
        {place.elections.length === 0 ? (
          <Empty text="No upcoming elections listed yet." />
        ) : (
          place.elections.map((e) => {
            const d = new Date(`${e.electionDate}T12:00:00Z`);
            return (
              <Pressable
                key={e.id}
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/election/[id]', params: { id: e.id } })}
                style={({ pressed }) => [
                  styles.election,
                  { borderBottomColor: theme.backgroundSelected },
                  pressed && { opacity: 0.75 },
                ]}
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
                    {e.kind[0]!.toUpperCase() + e.kind.slice(1)} election
                    {e.candidates ? ` · ${e.candidates} candidates` : ''}
                  </ThemedText>
                  {e.candidates ? (
                    <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
                      Cast a mock ballot →
                    </ThemedText>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
        <View style={styles.guideLinks}>
          <GuideLink slug="register-to-vote" label="Register or check your registration" />
          <GuideLink slug="contact-your-officials" label="Contact your officials" />
        </View>
      </Section>

      <Section title="Current leaders" caption="Trust score, 0-100">
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

function GuideLink({ slug, label }: { slug: string; label: string }) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/guide/[slug]', params: { slug } })}
      style={({ pressed }) => [
        styles.childChip,
        { backgroundColor: theme.backgroundElement },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Ionicons name="book-outline" size={14} color={Brand.humanity} />
      <ThemedText type="caption" style={{ fontWeight: 700 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** One headline cost number; tap to open the full breakdown. */
function LivingTab({ place }: { place: Place }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const cost = place.cost;
  const col = place.stats.find((s) => s.key === 'cost_of_living');
  let compare: { text: string; color: string } | null = null;
  if (cost?.peerMedian) {
    const diff = ((cost.basicsMonthly - cost.peerMedian) / cost.peerMedian) * 100;
    compare =
      Math.abs(diff) < 1
        ? { text: `About the median of ${place.peerLabel}`, color: theme.textSecondary }
        : {
            text: `${Math.abs(diff).toFixed(0)}% ${diff > 0 ? 'more' : 'less'} than the median of ${place.peerLabel}`,
            color: diff > 0 ? Brand.dislike : Brand.like,
          };
  }
  return (
    <View>
      {place.stats.some((s) => s.isSample) ? (
        <SampleBanner what="these statistics are made up" />
      ) : null}
      {cost ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`Monthly basics ${formatStat(cost.basicsMonthly, 'usd_month')}. ${open ? 'Hide' : 'Show'} breakdown`}
          onPress={() => setOpen((o) => !o)}
          style={({ pressed }) => [
            styles.costCard,
            { backgroundColor: theme.backgroundElement },
            pressed && { opacity: 0.85 },
          ]}
        >
          <ThemedText type="caption" themeColor="textSecondary">
            MONTHLY BASICS, ONE ADULT
          </ThemedText>
          <ThemedText style={styles.costValue}>
            {formatStat(cost.basicsMonthly, 'usd_month')}
          </ThemedText>
          {compare ? (
            <ThemedText type="smallBold" style={{ color: compare.color }}>
              {compare.text}
            </ThemedText>
          ) : null}
          <View style={styles.costMore}>
            <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
              {open ? 'Hide the breakdown' : 'See the full breakdown'}
            </ThemedText>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={Brand.primary} />
          </View>
        </Pressable>
      ) : (
        <Empty text="No cost data yet for this place." />
      )}
      {open && cost ? (
        <View>
          <View style={styles.note}>
            <ThemedText type="small" themeColor="textSecondary">
              How it’s calculated: {cost.formula}
            </ThemedText>
            {cost.realIncome && col ? (
              <ThemedText type="small">
                Median income adjusted for local prices:{' '}
                <ThemedText type="smallBold">{formatStat(cost.realIncome, 'usd_year')}</ThemedText>{' '}
                (cost-of-living index {Math.round(col.value)}, where 100 = U.S. average).
              </ThemedText>
            ) : null}
          </View>
          <StatGrid stats={place.stats} peerLabel={place.peerLabel} />
          <View style={styles.note}>
            <ThemedText type="caption" themeColor="textSecondary">
              Green means better for residents than the typical place in its group, orange means
              worse. Each figure lists its source and year.
            </ThemedText>
          </View>
        </View>
      ) : null}
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
  guideLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
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
  note: { padding: Spacing.three, gap: Spacing.two },
  costCard: {
    margin: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.large,
    gap: Spacing.one + 2,
  },
  costValue: { fontSize: 44, lineHeight: 50, fontWeight: 900 },
  costMore: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.one },
  empty: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
