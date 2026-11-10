import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { billStatus, SampleBanner, STANCE_PRIVACY, StatusChip, TallyBar } from '@/components/civic';
import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, civic, describeError, type Bill } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

type Stance = 'support' | 'oppose';
const THRESHOLD = 110;

/**
 * Legislation swipe deck: swipe right to support, left to oppose (or use the
 * buttons). One stance per bill, private by design, results shown after.
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

  useEffect(() => {
    if (!ready) return;
    const load = member ? civic.deck(token!) : civic.bills(null);
    load.then((r) => setDeck(r.bills)).catch((err) => setError(describeError(err)));
  }, [ready, member, token]);

  const top = deck?.[0] ?? null;
  const next = deck?.[1] ?? null;

  // Animated values live in state (created once); the responder is rebuilt
  // only when the card on top or the viewer changes.
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
        .then(({ tally }) => setLast({ bill, stance, tally }))
        .catch((err) => {
          if (!(err instanceof ApiError && err.code === 'already_weighed_in'))
            setError(describeError(err));
        });
    },
    [pan, token, top, member],
  );

  const skip = () => {
    setDeck((d) => (d && d.length > 1 ? [...d.slice(1), d[0]!] : d));
  };

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

  return (
    <Screen
      title="Legislation"
      subtitle="Swipe right to support, left to oppose. Tap a card for details."
    >
      {deck?.some((b) => b.isSample) ? <SampleBanner what="these bills are made up" /> : null}
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
              New bills appear here as they’re introduced.
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
          {STANCE_PRIVACY}
        </ThemedText>
      </View>
    </Screen>
  );
}

function CardBody({ bill }: { bill: Bill }) {
  const sponsor = bill.sponsors.find((s) => s.role === 'sponsor');
  return (
    <View style={styles.body}>
      <View style={styles.meta}>
        <StatusChip status={bill.status} />
        {bill.bipartisan ? (
          <ThemedText type="caption" style={{ color: Brand.humanity, fontWeight: 800 }}>
            Common ground
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="caption" themeColor="textSecondary">
        {bill.number} · {bill.place.name}
      </ThemedText>
      <ThemedText style={styles.title}>{bill.title}</ThemedText>
      <ThemedText themeColor="textSecondary">{bill.summary}</ThemedText>
      <View style={styles.footer}>
        {bill.category ? (
          <ThemedText type="caption" style={{ fontWeight: 800 }}>
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
  center: { textAlign: 'center' },
  deck: { height: 420, marginTop: Spacing.two },
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
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { fontSize: 26, lineHeight: 31, fontWeight: 900 },
  footer: { gap: 4, marginTop: Spacing.two },
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
