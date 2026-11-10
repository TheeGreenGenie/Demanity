import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import {
  FollowToggle,
  SampleBanner,
  Section,
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
import { civic, describeError, type Bill } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';
import { stanceStore, type Stance } from '@/lib/stance-store';

export default function BillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'support' | 'oppose' | null>(null);
  // Your own stance, remembered only on this device (the server never knows it).
  const [mine, setMine] = useState<Stance | null>(null);

  useEffect(() => {
    stanceStore.get(id).then(setMine);
  }, [id]);

  useEffect(() => {
    civic
      .bill(token, id)
      .then(setBill)
      .catch((err) => setError(describeError(err)));
  }, [token, id]);

  async function weighIn(stance: 'support' | 'oppose') {
    if (!isFullyOnboarded(me) || !token) return router.push('/join');
    setBusy(stance);
    try {
      const { tally } = await civic.stance(token, id, stance);
      await stanceStore.set(id, stance);
      setMine(stance);
      setBill((b) => (b ? { ...b, weighedIn: true, tally } : b));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  if (!bill) return <Screen>{error ? <ErrorText message={error} /> : null}</Screen>;

  return (
    <Screen flush>
      {bill.isSample ? <SampleBanner what="this bill, its sponsors and dates are made up" /> : null}
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <StageBanner stage={bill.stage} />
          </View>
          <FollowToggle kind="bill" name={bill.id} />
        </View>
        <ThemedText type="caption" themeColor="textSecondary">
          {STAGES[bill.stage].blurb}
        </ThemedText>
        <View style={styles.meta}>
          <StatusChip status={bill.status} />
          <ThemedText type="caption" themeColor="textSecondary">
            {bill.number} · {bill.place.name}
          </ThemedText>
        </View>
        <ThemedText type="subtitle">{bill.title}</ThemedText>
        <ThemedText>{bill.summary}</ThemedText>
        {bill.impact ? (
          <View style={[styles.impact, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
              WHAT CHANGES FOR YOU
            </ThemedText>
            <ThemedText type="small">{bill.impact}</ThemedText>
          </View>
        ) : null}
        <ThemedText type="caption" themeColor="textSecondary">
          Introduced {bill.introducedAt} · Last action {bill.lastActionAt}
        </ThemedText>
        <View style={styles.links}>
          {bill.category ? (
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                router.push({ pathname: '/c/[slug]', params: { slug: bill.category!.slug } })
              }
              style={[styles.tag, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText type="caption" style={styles.bold}>
                c/{bill.category.slug}
              </ThemedText>
            </Pressable>
          ) : null}
          {bill.bipartisan ? (
            <View style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="caption" style={[styles.bold, { color: Brand.humanity }]}>
                Common ground: sponsors from more than one party
              </ThemedText>
            </View>
          ) : null}
        </View>
        {bill.sourceUrl ? (
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(bill.sourceUrl!)}>
            <ThemedText type="small" style={{ color: Brand.primary, fontWeight: 700 }}>
              Read the official text →
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        {bill.weighedIn && bill.tally ? (
          <>
            <ThemedText type="headline">How members weighed in</ThemedText>
            {mine ? (
              <ThemedText type="small" themeColor="textSecondary">
                You {mine === 'support' ? 'supported' : 'opposed'} this bill (remembered on this
                device only).
              </ThemedText>
            ) : null}
            <TallyBar tally={bill.tally} />
          </>
        ) : (
          <>
            <ThemedText type="headline">Do you support this bill?</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Results appear after you weigh in.
            </ThemedText>
            <View style={styles.stanceRow}>
              <View style={styles.flex}>
                <Button
                  title="Oppose"
                  variant="secondary"
                  onPress={() => weighIn('oppose')}
                  busy={busy === 'oppose'}
                />
              </View>
              <View style={styles.flex}>
                <Button
                  title={isFullyOnboarded(me) ? 'Support' : 'Join to weigh in'}
                  onPress={() => weighIn('support')}
                  busy={busy === 'support'}
                />
              </View>
            </View>
          </>
        )}
        <View style={styles.privacy}>
          <Ionicons name="lock-closed" size={13} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary" style={styles.flex}>
            {STANCE_PRIVACY}
          </ThemedText>
        </View>
        <ErrorText message={error} />
      </View>

      <Section title="Sponsors">
        {bill.sponsors.map((s) => (
          <Pressable
            key={s.slug}
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/leader/[slug]', params: { slug: s.slug } })}
            style={({ pressed }) => [
              styles.sponsor,
              { borderBottomColor: theme.backgroundSelected },
              pressed && { opacity: 0.75 },
            ]}
          >
            <Avatar name={s.name} size={36} />
            <View style={styles.flex}>
              <ThemedText type="smallBold">{s.name}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {s.role === 'sponsor' ? 'Sponsor' : 'Cosponsor'}
                {s.party ? ` · ${s.party}` : ''}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Pressable>
        ))}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: 800 },
  head: { padding: Spacing.three, gap: Spacing.two },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  impact: { borderRadius: Radius.medium, padding: Spacing.three - 4, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tag: { borderRadius: Radius.pill, paddingHorizontal: Spacing.three - 4, paddingVertical: 4 },
  card: {
    marginHorizontal: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    gap: Spacing.three - 4,
  },
  stanceRow: { flexDirection: 'row', gap: Spacing.two },
  privacy: { flexDirection: 'row', gap: Spacing.one + 2, alignItems: 'flex-start' },
  sponsor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
