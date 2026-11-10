import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  billStatus,
  Chips,
  SampleBanner,
  STAGES,
  StageBanner,
  STANCE_PRIVACY,
  StatusChip,
  TallyBar,
} from '@/components/civic';
import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  ApiError,
  civic,
  describeError,
  social,
  type Bill,
  type BillFilter,
  type BillStage,
  type Community,
} from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';
import { stanceStore } from '@/lib/stance-store';

type Stance = 'support' | 'oppose';
const THRESHOLD = 110;

const LEVELS = [
  { key: 'all', label: 'All' },
  { key: 'federal', label: 'Federal' },
  { key: 'state', label: 'State' },
] as const;
const STATES = [
  { key: 'all', label: 'All states' },
  { key: 'california', label: 'CA' },
  { key: 'texas', label: 'TX' },
  { key: 'florida', label: 'FL' },
  { key: 'new-york', label: 'NY' },
  { key: 'pennsylvania', label: 'PA' },
] as const;
const STAGE_OPTIONS = [
  { key: 'all', label: 'Any stage' },
  { key: 'proposed', label: STAGES.proposed.label, icon: STAGES.proposed.icon },
  { key: 'voting', label: STAGES.voting.label, icon: STAGES.voting.icon },
  { key: 'decided', label: STAGES.decided.label, icon: STAGES.decided.icon },
] as const;

/**
 * Legislation swipe deck: swipe right to support, left to oppose (or use the
 * buttons). Bills most relevant to you come first, each saying why. Filter by
 * level, state, stage and topic. One stance per bill, private by design.
 */
export default function BillsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { ready, token, me } = useAuth();
  const member = isFullyOnboarded(me) && token !== null;
  const [deck, setDeck] = useState<Bill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ bill: Bill; stance: Stance; tally: Bill['tally'] } | null>(
    null,
  );
  const [nudge, setNudge] = useState(false);
  const [level, setLevel] = useState<'all' | 'federal' | 'state'>('all');
  const [state, setState] = useState<string>('all');
  const [stage, setStage] = useState<'all' | BillStage>('all');
  const [topic, setTopic] = useState<string>('all');
  const [topics, setTopics] = useState<Community[]>([]);
  const [showTopics, setShowTopics] = useState(false);
  const [freshness, setFreshness] = useState<string | null>(null);

  // Data freshness (R23): when real federal bills were last synced.
  useEffect(() => {
    civic
      .freshness()
      .then((r) => {
        const c = r.sources.find((s) => s.source === 'congress.gov');
        if (c?.syncedThrough)
          setFreshness(
            `Federal bills from Congress.gov, synced through ${new Date(c.syncedThrough).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${c.healthy ? '' : ' (last sync failed)'}`,
          );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    social
      .communities(null, 'topic')
      .then((r) => setTopics(r.communities))
      .catch(() => undefined);
  }, []);

  const filter: BillFilter = useMemo(() => {
    const f: BillFilter = {};
    if (level !== 'all') f.scope = level;
    if (level === 'state' && state !== 'all') f.place = state;
    if (stage !== 'all') f.stage = stage;
    if (topic !== 'all') f.category = topic;
    return f;
  }, [level, state, stage, topic]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const load = member ? civic.deck(token!, filter) : civic.bills(null, filter);
    load
      .then((r) => !cancelled && (setDeck(r.bills), setError(null)))
      .catch((err) => !cancelled && setError(describeError(err)));
    return () => {
      cancelled = true;
    };
  }, [ready, member, token, filter]);

  const top = deck?.[0] ?? null;
  const next = deck?.[1] ?? null;
  const [pan] = useState(() => new Animated.ValueXY());

  const commit = useCallback(
    (stance: Stance) => {
      const bill = top;
      if (!bill) return;
      if (!member) {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        setNudge(true);
        return;
      }
      Animated.timing(pan, {
        toValue: { x: stance === 'support' ? 600 : -600, y: 0 },
        duration: 200,
        useNativeDriver: false,
      }).start(() => {
        setDeck((d) => (d ? d.slice(1) : d));
        pan.setValue({ x: 0, y: 0 });
      });
      civic
        .stance(token!, bill.id, stance)
        .then(({ tally }) => {
          void stanceStore.set(bill.id, stance); // remembered on this device only
          setLast({ bill, stance, tally });
        })
        .catch((err) => {
          if (!(err instanceof ApiError && err.code === 'already_weighed_in'))
            setError(describeError(err));
        });
    },
    [pan, token, top, member],
  );

  const skip = () => setDeck((d) => (d && d.length > 1 ? [...d.slice(1), d[0]!] : d));

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_e, g) => pan.setValue({ x: g.dx, y: g.dy }),
        onPanResponderRelease: (_e, g) => {
          if (g.dx > THRESHOLD) commit('support');
          else if (g.dx < -THRESHOLD) commit('oppose');
          else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        },
      }),
    [pan, commit],
  );

  const rotate = pan.x.interpolate({
    inputRange: [-300, 0, 300],
    outputRange: ['-12deg', '0deg', '12deg'],
  });
  const supportOpacity = pan.x.interpolate({
    inputRange: [0, THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const opposeOpacity = pan.x.interpolate({
    inputRange: [-THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const topicName = topics.find((t) => t.slug === topic)?.name;

  return (
    <Screen
      title="Bills"
      subtitle="Swipe right to support, left to oppose. Tap a card for details."
    >
      <View style={styles.filters}>
        <Chips label="Level" options={LEVELS} value={level} onChange={setLevel} />
        {level === 'state' ? (
          <Chips label="State" options={STATES} value={state} onChange={setState} />
        ) : null}
        <Chips label="Stage" options={STAGE_OPTIONS} value={stage} onChange={setStage} />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showTopics }}
          onPress={() => setShowTopics((s) => !s)}
          style={[styles.topicButton, { backgroundColor: theme.backgroundElement }]}
        >
          <Ionicons name="pricetags-outline" size={14} color={theme.text} />
          <ThemedText type="caption" style={styles.bold}>
            {topic === 'all' ? 'All topics' : topicName}
          </ThemedText>
          <Ionicons
            name={showTopics ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.text}
          />
        </Pressable>
        {showTopics ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Chips
              label="Topic"
              value={topic}
              onChange={(t) => {
                setTopic(t);
                setShowTopics(false);
              }}
              options={[
                { key: 'all', label: 'All topics' },
                ...topics.map((t) => ({ key: t.slug, label: t.name })),
              ]}
            />
          </ScrollView>
        ) : null}
      </View>

      {freshness ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {freshness}
        </ThemedText>
      ) : null}
      {deck?.some((b) => b.isSample) ? (
        <SampleBanner what="bills marked [Sample] are made up; the others are real" />
      ) : null}
      <ErrorText message={error} />

      {nudge && !member ? (
        <View style={[styles.nudge, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="headline">Join to weigh in</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Only verified members can support or oppose bills, one stance per person.
          </ThemedText>
          <Button title="Join Demanity" onPress={() => router.push('/join')} />
        </View>
      ) : null}

      <View style={styles.deck}>
        {deck && deck.length === 0 ? (
          <View style={[styles.card, styles.done, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="checkmark-done-circle" size={56} color={Brand.like} />
            <ThemedText type="headline">You’re all caught up</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              No bills match these filters. Try another stage or topic.
            </ThemedText>
          </View>
        ) : null}
        {next ? (
          <View
            style={[
              styles.card,
              styles.behind,
              { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
            ]}
          >
            <CardBody bill={next} />
          </View>
        ) : null}
        {top ? (
          <Animated.View
            {...responder.panHandlers}
            style={[
              styles.card,
              {
                backgroundColor: theme.surfaceRaised,
                borderColor: theme.backgroundSelected,
                transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }],
              },
            ]}
          >
            <Animated.View style={[styles.stamp, styles.stampSupport, { opacity: supportOpacity }]}>
              <ThemedText style={[styles.stampText, { color: Brand.like }]}>SUPPORT</ThemedText>
            </Animated.View>
            <Animated.View style={[styles.stamp, styles.stampOppose, { opacity: opposeOpacity }]}>
              <ThemedText style={[styles.stampText, { color: Brand.dislike }]}>OPPOSE</ThemedText>
            </Animated.View>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${top.title}. Open details`}
              onPress={() => router.push({ pathname: '/bill/[id]', params: { id: top.id } })}
            >
              <CardBody bill={top} />
            </Pressable>
          </Animated.View>
        ) : null}
      </View>

      {top ? (
        <View style={styles.actions}>
          <RoundButton
            label="Oppose"
            icon="close"
            color={Brand.dislike}
            onPress={() => commit('oppose')}
          />
          <RoundButton label="Skip for now" icon="arrow-redo" small onPress={skip} />
          <RoundButton
            label="Support"
            icon="checkmark"
            color={Brand.like}
            onPress={() => commit('support')}
          />
        </View>
      ) : null}

      {last ? (
        <View style={[styles.result, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="caption" themeColor="textSecondary">
            You {last.stance === 'support' ? 'supported' : 'opposed'} · {last.bill.number}
          </ThemedText>
          <ThemedText type="smallBold" numberOfLines={1}>
            {last.bill.title}
          </ThemedText>
          {last.tally ? <TallyBar tally={last.tally} /> : null}
        </View>
      ) : null}

      <View style={styles.privacy}>
        <Ionicons name="lock-closed" size={13} color={theme.textSecondary} />
        <ThemedText type="caption" themeColor="textSecondary" style={styles.flex}>
          {STANCE_PRIVACY} Your own choices are remembered on this device only.
        </ThemedText>
      </View>
    </Screen>
  );
}

function CardBody({ bill }: { bill: Bill }) {
  const theme = useTheme();
  const sponsor = bill.sponsors.find((s) => s.role === 'sponsor');
  return (
    <View style={styles.body}>
      <View style={styles.meta}>
        <StageBanner stage={bill.stage} />
        <StatusChip status={bill.status} />
        {bill.bipartisan ? (
          <ThemedText type="caption" style={{ color: Brand.humanity, fontWeight: 800 }}>
            Common ground
          </ThemedText>
        ) : null}
      </View>
      {bill.reason ? (
        <View style={styles.reason}>
          <Ionicons name="sparkles" size={13} color={Brand.primary} />
          <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
            {bill.reason}
          </ThemedText>
        </View>
      ) : null}
      <ThemedText type="caption" themeColor="textSecondary">
        {bill.level === 'federal' ? 'Federal' : 'State'} · {bill.number} · {bill.place.name}
      </ThemedText>
      <ThemedText style={styles.title}>{bill.title}</ThemedText>
      <ThemedText themeColor="textSecondary" numberOfLines={3}>
        {bill.summary}
      </ThemedText>
      {bill.impact ? (
        <View style={[styles.impact, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
            WHAT CHANGES FOR YOU
          </ThemedText>
          <ThemedText type="small">{bill.impact}</ThemedText>
        </View>
      ) : null}
      <View style={styles.footer}>
        {bill.category ? (
          <ThemedText type="caption" style={styles.bold}>
            c/{bill.category.slug}
          </ThemedText>
        ) : null}
        <ThemedText type="caption" themeColor="textSecondary">
          {sponsor ? `Sponsor: ${sponsor.name} (${sponsor.party})` : ''}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {billStatus(bill.status).label} · last action {bill.lastActionAt}
        </ThemedText>
      </View>
    </View>
  );
}

function RoundButton({
  label,
  icon,
  color,
  small = false,
  onPress,
}: {
  label: string;
  icon: 'close' | 'checkmark' | 'arrow-redo';
  color?: string;
  small?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const size = small ? 52 : 68;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color ?? theme.backgroundSelected,
          backgroundColor: theme.backgroundElement,
        },
        pressed && { transform: [{ scale: 0.92 }] },
      ]}
    >
      <Ionicons name={icon} size={small ? 22 : 32} color={color ?? theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: 800 },
  center: { textAlign: 'center' },
  filters: { gap: Spacing.two },
  topicButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.one + 2,
  },
  deck: { height: 480, marginTop: Spacing.two },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.large,
    borderWidth: 1,
    overflow: 'hidden',
  },
  behind: { transform: [{ scale: 0.95 }, { translateY: 14 }], opacity: 0.7 },
  done: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  body: { padding: Spacing.four, gap: Spacing.two },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { fontSize: 26, lineHeight: 31, fontWeight: 900 },
  impact: { borderRadius: Radius.medium, padding: Spacing.three - 4, gap: 2 },
  footer: { gap: 4, marginTop: Spacing.one },
  stamp: {
    position: 'absolute',
    top: Spacing.four,
    zIndex: 2,
    borderWidth: 3,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.two,
  },
  stampSupport: { left: Spacing.four, borderColor: Brand.like, transform: [{ rotate: '-12deg' }] },
  stampOppose: {
    right: Spacing.four,
    borderColor: Brand.dislike,
    transform: [{ rotate: '12deg' }],
  },
  stampText: { fontSize: 26, lineHeight: 32, fontWeight: 900 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.five,
    marginTop: Spacing.three,
  },
  round: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  result: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.one + 2 },
  nudge: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  privacy: { flexDirection: 'row', gap: Spacing.one + 2, alignItems: 'flex-start' },
});
