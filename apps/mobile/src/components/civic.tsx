import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Bill, CategoryScore, LeaderSummary, Overall, Stat } from '@/lib/api';

/**
 * Civic building blocks: tabs, 0-100 score badges, expandable score rows,
 * quality-of-life stat cards, bill cards and leader rows.
 */

export const PEER_WORDS: Record<string, [string, string]> = {
  nation: ['nation', 'nations'],
  state: ['state', 'states'],
  county: ['county', 'counties'],
  city: ['city', 'cities'],
  court_district: ['court district', 'court districts'],
  congressional_district: ['congressional district', 'congressional districts'],
  president: ['president', 'presidents'],
  us_senate: ['U.S. senator', 'U.S. senators'],
  us_house: ['U.S. representative', 'U.S. representatives'],
  governor: ['governor', 'governors'],
  state_senate: ['state senator', 'state senators'],
  state_house: ['state representative', 'state representatives'],
  mayor: ['mayor', 'mayors'],
  county_executive: ['county executive', 'county executives'],
};
export const peerWord = (kind: string, plural = true) =>
  PEER_WORDS[kind]?.[plural ? 1 : 0] ?? (plural ? 'peers' : 'peer');

/** Score colors: green good, amber middling, orange poor (never party red/blue). */
export function scoreColor(score: number | null): string {
  if (score === null) return '#5B6170';
  if (score >= 65) return Brand.like;
  if (score >= 40) return Brand.kudos;
  return Brand.dislike;
}

/** Reddit-style tab bar: text tabs with an underline on the active one. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.tabsWrap, { borderBottomColor: theme.backgroundSelected }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        contentContainerStyle={styles.tabs}
      >
        {tabs.map((t) => {
          const active = t.key === value;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(t.key)}
              style={styles.tab}
            >
              <ThemedText
                type="smallBold"
                themeColor={active ? 'text' : 'textSecondary'}
                style={active ? styles.tabActiveText : undefined}
              >
                {t.label}
              </ThemedText>
              <View
                style={[
                  styles.tabLine,
                  { backgroundColor: active ? Brand.primary : 'transparent' },
                ]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Small chips for sorting (Hot / New / Top) and filters. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { key: T; label: string; icon?: ComponentProps<typeof Ionicons>['name'] }[];
  value: T;
  onChange: (key: T) => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <View accessibilityLabel={label} style={styles.chips}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: active ? theme.text : theme.backgroundElement,
              },
              pressed && { opacity: 0.75 },
            ]}
          >
            {o.icon ? (
              <Ionicons name={o.icon} size={14} color={active ? theme.background : theme.text} />
            ) : null}
            <ThemedText
              type="caption"
              style={[styles.chipText, active && { color: theme.background }]}
            >
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Clear banner on anything made of illustrative data. */
export function SampleBanner({ what = 'these figures are made up' }: { what?: string }) {
  return (
    <View accessibilityRole="alert" style={styles.sample}>
      <Ionicons name="flask-outline" size={16} color="#000" />
      <ThemedText type="caption" style={styles.sampleText}>
        Sample data for design only: {what}.
      </ThemedText>
    </View>
  );
}

export function Section({
  title,
  caption,
  children,
  right,
}: {
  title: string;
  caption?: string;
  children?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.flex}>
          <ThemedText type="headline">{title}</ThemedText>
          {caption ? (
            <ThemedText type="caption" themeColor="textSecondary">
              {caption}
            </ThemedText>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Round 0-100 badge. */
export function ScoreBadge({ score, size = 44 }: { score: number | null; size?: number }) {
  const color = scoreColor(score);
  return (
    <View
      accessibilityLabel={score === null ? 'Not scored yet' : `Score ${score} out of 100`}
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, borderColor: color },
      ]}
    >
      <ThemedText
        style={{ fontWeight: 900, fontSize: size * 0.38, lineHeight: size * 0.46, color }}
      >
        {score === null ? '–' : score}
      </ThemedText>
    </View>
  );
}

/** Big overall score card with peer rank. */
export function OverallCard({ overall, peerKind }: { overall: Overall; peerKind: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.overall, { backgroundColor: theme.backgroundElement }]}>
      <ScoreBadge score={overall.score} size={72} />
      <View style={styles.flex}>
        <ThemedText type="headline">Overall score</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {overall.score === null
            ? 'Not enough evidence yet.'
            : overall.peers
              ? `Ranks ${overall.peers.rank} of ${overall.peers.count} ${peerWord(peerKind)} · from ${overall.categoriesCounted} categories`
              : `From ${overall.categoriesCounted} categories`}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          Method under public review
        </ThemedText>
      </View>
    </View>
  );
}

/** Horizontal 0-100 bar with a peer-average tick. */
function ScoreBar({ score, average }: { score: number; average: number | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.barFill, { width: `${score}%`, backgroundColor: scoreColor(score) }]} />
      {average !== null ? (
        <View style={[styles.barTick, { left: `${average}%`, backgroundColor: theme.text }]} />
      ) : null}
    </View>
  );
}

/** One category: tap to open the full explanation, evidence and peer comparison. */
export function ScoreRow({ item, peerKind }: { item: CategoryScore; peerKind: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const scored = item.score !== null;
  return (
    <View style={[styles.scoreRow, { borderBottomColor: theme.backgroundSelected }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${item.category.name}: ${scored ? `${item.score} out of 100` : 'not scored yet'}`}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.scoreHead, pressed && { opacity: 0.7 }]}
      >
        <ScoreBadge score={item.score} size={40} />
        <View style={styles.flex}>
          <ThemedText type="smallBold" numberOfLines={2}>
            {item.category.name}
          </ThemedText>
          {scored ? (
            <>
              <ScoreBar score={item.score!} average={item.peers?.average ?? null} />
              <ThemedText type="caption" themeColor="textSecondary">
                {item.peers
                  ? `#${item.peers.rank} of ${item.peers.count} ${peerWord(peerKind)} · avg ${item.peers.average}`
                  : 'No peers scored yet'}
                {item.lowEvidence ? ' · low evidence' : ''}
              </ThemedText>
            </>
          ) : (
            <ThemedText type="caption" themeColor="textSecondary">
              Not scored yet
            </ThemedText>
          )}
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.textSecondary}
        />
      </Pressable>
      {open ? (
        <View style={styles.scoreBody}>
          {scored ? (
            <>
              <ThemedText type="smallBold">Why {item.score}/100</ThemedText>
              <ThemedText type="small">{item.rationale}</ThemedText>
              {item.peers ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Compared only with other {peerWord(peerKind)}: ranks {item.peers.rank} of{' '}
                  {item.peers.count}; the average is {item.peers.average} (the white tick on the
                  bar).
                </ThemedText>
              ) : null}
              <ThemedText type="smallBold">Evidence ({item.evidenceCount})</ThemedText>
              {item.evidence.map((e, i) => (
                <Pressable
                  key={i}
                  disabled={!e.url}
                  onPress={() => e.url && Linking.openURL(e.url)}
                  accessibilityRole={e.url ? 'link' : undefined}
                  style={styles.evidence}
                >
                  <Ionicons
                    name={e.url ? 'link-outline' : 'document-text-outline'}
                    size={14}
                    color={theme.textSecondary}
                  />
                  <ThemedText
                    type="caption"
                    style={[styles.flex, e.url ? { color: Brand.primary } : undefined]}
                  >
                    {e.label}
                  </ThemedText>
                </Pressable>
              ))}
              <ThemedText type="caption" themeColor="textSecondary">
                {item.lowEvidence ? 'Low evidence: treat this as a first impression. ' : ''}
                Method {item.methodVersion} · as of {item.asOf}
              </ThemedText>
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              No evidence has been rated in this category yet, so there is no score. Scores appear
              once sources are added and reviewed.
            </ThemedText>
          )}
        </View>
      ) : null}
    </View>
  );
}

type ScoreSort = 'az' | 'high' | 'low';

/** All 32 categories, sortable, each expandable. */
export function ScoreList({ items, peerKind }: { items: CategoryScore[]; peerKind: string }) {
  const [sort, setSort] = useState<ScoreSort>('az');
  const sorted = [...items].sort((a, b) => {
    if (sort === 'az') return a.category.name.localeCompare(b.category.name);
    const av = a.score ?? (sort === 'high' ? -1 : 101);
    const bv = b.score ?? (sort === 'high' ? -1 : 101);
    return sort === 'high' ? bv - av : av - bv;
  });
  return (
    <View>
      <View style={styles.pad}>
        <Chips
          label="Sort categories"
          value={sort}
          onChange={setSort}
          options={[
            { key: 'az', label: 'A–Z' },
            { key: 'high', label: 'Strongest', icon: 'trending-up' },
            { key: 'low', label: 'Weakest', icon: 'trending-down' },
          ]}
        />
        <ThemedText type="caption" themeColor="textSecondary">
          Tap a category to see why it got its score.
        </ThemedText>
      </View>
      {sorted.map((s) => (
        <ScoreRow key={s.category.slug} item={s} peerKind={peerKind} />
      ))}
    </View>
  );
}

export function formatStat(value: number, unit: Stat['unit']): string {
  const usd = (n: number, digits = 0) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  switch (unit) {
    case 'usd':
      return usd(value, 2);
    case 'usd_month':
      return `${usd(value)}/mo`;
    case 'usd_year':
      return `${usd(value)}/yr`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'minutes':
      return `${Math.round(value)} min`;
    default:
      return String(Math.round(value));
  }
}

/** Quality-of-life statistic, compared with the median of the same kind of place. */
export function StatCard({ stat, peerKind }: { stat: Stat; peerKind: string }) {
  const theme = useTheme();
  let compare: ReactNode = null;
  if (stat.peerMedian !== null && stat.peerMedian !== 0 && stat.peerCount > 1) {
    const diff = ((stat.value - stat.peerMedian) / stat.peerMedian) * 100;
    const better = stat.higherIsBetter ? diff > 0 : diff < 0;
    const flat = Math.abs(diff) < 1;
    const color = flat ? theme.textSecondary : better ? Brand.like : Brand.dislike;
    compare = (
      <View style={styles.statCompare}>
        <Ionicons
          name={flat ? 'remove' : diff > 0 ? 'arrow-up' : 'arrow-down'}
          size={13}
          color={color}
        />
        <ThemedText type="caption" style={{ color, fontWeight: 700 }}>
          {flat ? 'About' : `${Math.abs(diff).toFixed(0)}% ${diff > 0 ? 'above' : 'below'}`} the
          median of {stat.peerCount} {peerWord(peerKind)}
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={[styles.stat, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
        {stat.label}
      </ThemedText>
      <ThemedText style={styles.statValue}>{formatStat(stat.value, stat.unit)}</ThemedText>
      {compare}
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
        {stat.sourceLabel}
        {stat.asOf ? ` · ${stat.asOf.slice(0, 4)}` : ''}
      </ThemedText>
    </View>
  );
}

export function StatGrid({ stats, peerKind }: { stats: Stat[]; peerKind: string }) {
  return (
    <View style={styles.statGrid}>
      {stats.map((s) => (
        <StatCard key={s.key} stat={s} peerKind={peerKind} />
      ))}
    </View>
  );
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  introduced: { label: 'Introduced', color: '#8B919C' },
  in_committee: { label: 'In committee', color: '#8B919C' },
  passed_chamber: { label: 'Passed one chamber', color: Brand.location },
  passed: { label: 'Passed', color: Brand.like },
  signed: { label: 'Signed into law', color: Brand.like },
  vetoed: { label: 'Vetoed', color: Brand.dislike },
  failed: { label: 'Failed', color: Brand.dislike },
};
export const billStatus = (s: string) => STATUS_LABEL[s] ?? { label: s, color: '#8B919C' };

export function StatusChip({ status }: { status: string }) {
  const s = billStatus(status);
  return (
    <View style={[styles.status, { borderColor: s.color }]}>
      <ThemedText type="caption" style={{ color: s.color, fontWeight: 800 }}>
        {s.label}
      </ThemedText>
    </View>
  );
}

export function BillCard({ bill }: { bill: Bill }) {
  const router = useRouter();
  const theme = useTheme();
  const sponsor = bill.sponsors.find((s) => s.role === 'sponsor');
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/bill/[id]', params: { id: bill.id } })}
      style={({ pressed }) => [
        styles.bill,
        { borderBottomColor: theme.backgroundSelected },
        pressed && { opacity: 0.75 },
      ]}
    >
      <View style={styles.billMeta}>
        <StatusChip status={bill.status} />
        <ThemedText type="caption" themeColor="textSecondary">
          {bill.number} · {bill.place.name}
        </ThemedText>
        {bill.bipartisan ? (
          <ThemedText type="caption" style={{ color: Brand.humanity, fontWeight: 800 }}>
            · Common ground
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="headline">{bill.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
        {bill.summary}
      </ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        {bill.category ? `${bill.category.name} · ` : ''}
        {sponsor ? `Sponsor: ${sponsor.name} (${sponsor.party.slice(0, 1)})` : ''} · Last action{' '}
        {bill.lastActionAt}
      </ThemedText>
    </Pressable>
  );
}

export function LeaderRow({ leader }: { leader: LeaderSummary }) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${leader.name}, ${leader.office}`}
      onPress={() => router.push({ pathname: '/leader/[slug]', params: { slug: leader.slug } })}
      style={({ pressed }) => [
        styles.leader,
        { borderBottomColor: theme.backgroundSelected },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Avatar name={leader.name} size={44} />
      <View style={styles.flex}>
        <ThemedText type="smallBold">{leader.name}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {leader.office}
          {leader.party ? ` · ${leader.party}` : ''}
        </ThemedText>
      </View>
      <ScoreBadge score={leader.overall} size={40} />
    </Pressable>
  );
}

export const STANCE_PRIVACY =
  'Private by design: Demanity records that you weighed in, not which way. Your choice is only added to an anonymous total, and it can�t be changed.';

/** How members weighed in (shown only after you have). */
export function TallyBar({ tally }: { tally: { support: number; oppose: number } }) {
  const theme = useTheme();
  const total = tally.support + tally.oppose;
  const pct = total === 0 ? 0 : Math.round((tally.support / total) * 100);
  return (
    <View style={styles.tally}>
      <View style={styles.tallyLabels}>
        <ThemedText type="smallBold" style={{ color: Brand.like }}>
          {pct}% support
        </ThemedText>
        <ThemedText type="smallBold" style={{ color: Brand.dislike }}>
          {total === 0 ? 0 : 100 - pct}% oppose
        </ThemedText>
      </View>
      <View
        style={[
          styles.tallyBar,
          { backgroundColor: total ? Brand.dislike : theme.backgroundSelected },
        ]}
      >
        <View style={[styles.tallyFill, { width: `${pct}%` }]} />
      </View>
      <ThemedText type="caption" themeColor="textSecondary">
        n = {total} Demanity {total === 1 ? 'member' : 'members'}. Members choose to be here, so
        this describes them, not all Americans.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  tally: { gap: Spacing.one + 2 },
  tallyLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  tallyBar: { height: 10, borderRadius: 5, overflow: 'hidden' },
  tallyFill: { height: 10, backgroundColor: Brand.like },
  flex: { flex: 1, gap: 2 },
  pad: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two },
  tabsWrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { paddingHorizontal: Spacing.two },
  tab: { paddingHorizontal: Spacing.three - 4, paddingTop: Spacing.three - 4, gap: Spacing.two },
  tabActiveText: { fontWeight: 900 },
  tabLine: { height: 3, borderRadius: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.one + 2,
  },
  chipText: { fontWeight: 800 },
  sample: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Brand.kudos,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.small,
  },
  sampleText: { color: '#000', fontWeight: 700, flex: 1 },
  section: { gap: Spacing.two, paddingTop: Spacing.four },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  badge: { borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  overall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
  },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden', marginVertical: 3 },
  barFill: { height: 6, borderRadius: 3 },
  barTick: { position: 'absolute', width: 2, top: 0, bottom: 0 },
  scoreRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  scoreHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 4,
  },
  scoreBody: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    paddingLeft: Spacing.three + 40 + Spacing.three,
    gap: Spacing.two,
  },
  evidence: { flexDirection: 'row', gap: Spacing.one + 2, alignItems: 'flex-start' },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  stat: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: Spacing.three - 4,
    borderRadius: Radius.medium,
    gap: Spacing.one,
  },
  statValue: { fontSize: 24, lineHeight: 30, fontWeight: 900 },
  statCompare: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  status: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  bill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  billMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2, flexWrap: 'wrap' },
  leader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
