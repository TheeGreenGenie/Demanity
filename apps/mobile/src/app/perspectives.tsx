import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Section } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError, perspectives, type Perspective } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

const REMOVE_REASONS = [
  { key: 'abusive_entry', label: 'Abusive' },
  { key: 'source_does_not_support_claim', label: 'Source doesn’t support it' },
  { key: 'other_policy_violation', label: 'Other violation' },
] as const;

/**
 * "Does this citation offend you?" (R29): opened only by choice. A general
 * explanation, then devil's-advocate entries from contributors in the
 * citation's topic, each with an approved source. Helpful entries earn their
 * authors contribution points.
 */
export default function PerspectivesScreen() {
  const { citation } = useLocalSearchParams<{ citation: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const member = isFullyOnboarded(me) && token !== null;
  const [data, setData] = useState<Awaited<ReturnType<typeof perspectives.list>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [added, setAdded] = useState(false);

  const load = useCallback(() => {
    if (!citation) return;
    perspectives
      .list(token, citation)
      .then(setData)
      .catch((err) => setError(describeError(err)));
  }, [token, citation]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      load();
    } catch (err) {
      setError(describeError(err));
    }
  };

  if (!data) return <Screen>{error ? <ErrorText message={error} /> : null}</Screen>;
  return (
    <Screen
      title="Other perspectives"
      subtitle={`${data.citation.leader} · ${data.citation.category}`}
    >
      <View style={[styles.quote, { borderLeftColor: theme.backgroundSelected }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {data.citation.claim}
        </ThemedText>
      </View>
      <ThemedText>{data.intro}</ThemedText>
      <ErrorText message={error} />

      <Section
        title={`Reasons this may not reflect your view (${data.entries.length})`}
        caption="Most helpful first. Votes are private: we store totals, not who voted which way."
      />
      {data.entries.length === 0 ? (
        <ThemedText themeColor="textSecondary">
          No perspectives yet. Contributors in this topic can add one.
        </ThemedText>
      ) : null}
      {data.entries.map((e) => (
        <Entry
          key={e.id}
          entry={e}
          onVote={(helpful) =>
            member ? act(() => perspectives.vote(token!, e.id, helpful)) : router.push('/join')
          }
          onRemove={
            me?.moderator && !e.mine
              ? (reason) => act(() => perspectives.remove(token!, e.id, reason))
              : undefined
          }
        />
      ))}

      {member ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="headline">Add a perspective</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            For contributors in this topic. Explain, in good faith, why someone might see this
            record differently, and cite an approved source.
          </ThemedText>
          {added ? (
            <ThemedText type="caption" style={{ color: Brand.like, fontWeight: 800 }}>
              Added.
            </ThemedText>
          ) : (
            <>
              <Field
                label="Perspective"
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={1500}
              />
              <Field
                label="Source link"
                value={source}
                onChangeText={setSource}
                autoCapitalize="none"
                placeholder="https://www.congress.gov/…"
              />
              <Button
                title="Add perspective"
                size="small"
                onPress={() =>
                  act(async () => {
                    await perspectives.add(token!, citation!, body.trim(), source.trim());
                    setAdded(true);
                  })
                }
              />
            </>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function Entry({
  entry: e,
  onVote,
  onRemove,
}: {
  entry: Perspective;
  onVote: (helpful: boolean) => void;
  onRemove?: (reason: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small">{e.body}</ThemedText>
      <Pressable
        accessibilityRole="link"
        onPress={() => Linking.openURL(e.sourceUrl)}
        style={styles.row}
      >
        <Ionicons name="link-outline" size={13} color={Brand.primary} />
        <ThemedText type="caption" style={{ color: Brand.primary }} numberOfLines={1}>
          {e.sourceName}
        </ThemedText>
      </Pressable>
      <View style={styles.row}>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.flex}>
          {e.votes > 0 ? `${e.helpful} of ${e.votes} found this helpful` : 'No votes yet'}
        </ThemedText>
        {e.voted || e.mine ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {e.mine ? 'Your entry' : 'You voted'}
          </ThemedText>
        ) : (
          <>
            <Button
              title="Not helpful"
              size="small"
              variant="ghost"
              onPress={() => onVote(false)}
            />
            <Button title="Helpful" size="small" variant="secondary" onPress={() => onVote(true)} />
          </>
        )}
      </View>
      {onRemove ? (
        <View style={styles.row}>
          {REMOVE_REASONS.map((r) => (
            <Button
              key={r.key}
              title={`Remove: ${r.label}`}
              size="small"
              variant="ghost"
              onPress={() => onRemove(r.key)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  card: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  quote: { borderLeftWidth: 3, paddingLeft: Spacing.two },
});
