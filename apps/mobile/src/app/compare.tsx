import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ScoreBadge } from '@/components/civic';
import { ErrorText } from '@/components/form';
import { LeaderPhoto, POSITION } from '@/components/leader-sections';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError, leaders, type CompareSide, type SearchResults } from '@/lib/api';

/**
 * VS comparison (R14): two leaders side by side, every applicable topic's
 * trust score, their latest stated position, and the overall score.
 */
export default function CompareScreen() {
  const params = useLocalSearchParams<{ a: string; b?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const [data, setData] = useState<{
    a: CompareSide;
    b: CompareSide;
    categories: { slug: string; name: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults['leaders']>([]);

  useEffect(() => {
    if (!params.b) return;
    leaders
      .compare(params.a, params.b)
      .then(setData)
      .catch((err) => setError(describeError(err)));
  }, [params.a, params.b]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      civic
        .search(null, q.trim())
        .then((r) => setResults(r.leaders.filter((l) => l.slug !== params.a)))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q, params.a]);

  if (!params.b)
    return (
      <Screen title="Compare with…" subtitle="Search for another leader.">
        <TextInput
          accessibilityLabel="Search leaders"
          placeholder="Name or office, e.g. Senator"
          placeholderTextColor={theme.textSecondary}
          value={q}
          onChangeText={setQ}
          style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        />
        {results.map((l) => (
          <Pressable
            key={l.slug}
            accessibilityRole="button"
            onPress={() => router.setParams({ b: l.slug })}
            style={({ pressed }) => [
              styles.result,
              { borderBottomColor: theme.backgroundSelected },
              pressed && { opacity: 0.7 },
            ]}
          >
            <ThemedText type="smallBold">{l.name}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {l.office}
              {l.party ? ` · ${l.party}` : ''}
            </ThemedText>
          </Pressable>
        ))}
      </Screen>
    );

  if (!data) return <Screen>{error ? <ErrorText message={error} /> : null}</Screen>;
  const { a, b } = data;
  return (
    <Screen flush>
      <View style={[styles.heads, { borderBottomColor: theme.backgroundSelected }]}>
        {[a, b].map((side) => (
          <Pressable
            key={side.leader.slug}
            accessibilityRole="link"
            onPress={() =>
              router.push({ pathname: '/leader/[slug]', params: { slug: side.leader.slug } })
            }
            style={styles.head}
          >
            <LeaderPhoto name={side.leader.name} photoUrl={side.leader.photoUrl} size={64} />
            <ThemedText type="smallBold" style={styles.center} numberOfLines={2}>
              {side.leader.name}
            </ThemedText>
            <ThemedText
              type="caption"
              themeColor="textSecondary"
              style={styles.center}
              numberOfLines={2}
            >
              {side.leader.office}
            </ThemedText>
            <ScoreBadge score={side.overall.score} size={52} />
            <ThemedText type="caption" themeColor="textSecondary">
              Trust · {side.citations} citations
            </ThemedText>
          </Pressable>
        ))}
        <View style={styles.vs}>
          <ThemedText style={styles.vsText}>VS</ThemedText>
        </View>
      </View>
      {data.categories.map((c) => {
        const sa = a.scores[c.slug];
        const sb = b.scores[c.slug];
        const pa = a.stances[c.slug];
        const pb = b.stances[c.slug];
        if (sa?.score == null && sb?.score == null && !pa && !pb) return null;
        return (
          <View key={c.slug} style={[styles.row, { borderBottomColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold" style={styles.center}>
              {c.name}
            </ThemedText>
            <View style={styles.cells}>
              {[
                [sa, pa],
                [sb, pb],
              ].map(([s, p], i) => (
                <View key={i} style={styles.cell}>
                  <ScoreBadge score={(s as typeof sa)?.score ?? null} size={40} />
                  {p ? (
                    <ThemedText
                      type="caption"
                      style={{ color: POSITION[(p as typeof pa)!.position].color, fontWeight: 800 }}
                    >
                      {POSITION[(p as typeof pa)!.position].label}
                    </ThemedText>
                  ) : (
                    <ThemedText type="caption" themeColor="textSecondary">
                      No stated position
                    </ThemedText>
                  )}
                </View>
              ))}
            </View>
          </View>
        );
      })}
      <View style={styles.note}>
        <ThemedText type="caption" themeColor="textSecondary">
          Scores are trust scores from reviewed citations (0-100); “–” means not scored yet.
          Positions are their latest stated stance with a source on each leader’s Positions tab.
          Method under public review.
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  search: { height: 46, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, fontSize: 16 },
  result: { paddingVertical: Spacing.two + 2, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  heads: {
    flexDirection: 'row',
    padding: Spacing.three,
    gap: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  head: { flex: 1, alignItems: 'center', gap: Spacing.one + 2 },
  vs: {
    position: 'absolute',
    left: '50%',
    top: 40,
    marginLeft: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vsText: { color: '#fff', fontWeight: 900, fontSize: 13 },
  row: { padding: Spacing.three, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  cells: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', gap: 4 },
  note: { padding: Spacing.three },
});
