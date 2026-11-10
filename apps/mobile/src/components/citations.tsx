import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError, type Citation } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

/**
 * Accepted citations for one leader in one category, with the two reaction
 * buttons from the spec: "Accurate?" (feeds the score) and "Approve?" (shown
 * only). One vote of each per member; Demanity stores totals, not your choice.
 */
export function CitationList({ leaderSlug, category }: { leaderSlug: string; category: string }) {
  const router = useRouter();
  const { token } = useAuth();
  const [items, setItems] = useState<Citation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    civic
      .citations(token, leaderSlug, category)
      .then((r) => !cancelled && setItems(r.citations))
      .catch((err) => !cancelled && setError(describeError(err)));
    return () => {
      cancelled = true;
    };
  }, [token, leaderSlug, category]);

  return (
    <View style={styles.wrap}>
      <ThemedText type="smallBold">Citations</ThemedText>
      <ErrorText message={error} />
      {items && items.length === 0 ? (
        <ThemedText type="caption" themeColor="textSecondary">
          No accepted citations in this category yet.
        </ThemedText>
      ) : null}
      {(items ?? []).map((c) => (
        <CitationCard key={c.id} citation={c} />
      ))}
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push({ pathname: '/cite', params: { slug: leaderSlug, category } })}
      >
        <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
          + Add a citation (contributors)
        </ThemedText>
      </Pressable>
    </View>
  );
}

function CitationCard({ citation }: { citation: Citation }) {
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const [c, setC] = useState(citation);
  const [error, setError] = useState<string | null>(null);
  const positive = c.direction === 'positive';

  async function vote(kind: 'accurate' | 'approve', value: boolean) {
    if (!isFullyOnboarded(me) || !token) return router.push('/join');
    try {
      const totals = await civic.voteCitation(token, c.id, kind, value);
      setC((prev) => ({
        ...prev,
        ...totals,
        ...(kind === 'accurate' ? { votedAccurate: true } : { votedApprove: true }),
      }));
    } catch (err) {
      setError(describeError(err));
    }
  }

  const accVotes = c.accurateYes + c.accurateNo;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.background,
          borderLeftColor: positive ? Brand.like : Brand.dislike,
        },
      ]}
    >
      <ThemedText
        type="caption"
        style={{ color: positive ? Brand.like : Brand.dislike, fontWeight: 900 }}
      >
        {positive ? 'POSITIVE' : 'NEGATIVE'} · {c.actionDate} · {c.attribution}
      </ThemedText>
      <ThemedText type="small">{c.claim}</ThemedText>
      <Pressable
        accessibilityRole="link"
        onPress={() => Linking.openURL(c.sourceUrl)}
        style={styles.source}
      >
        <Ionicons name="link-outline" size={13} color={Brand.primary} />
        <ThemedText type="caption" style={{ color: Brand.primary }} numberOfLines={1}>
          {c.sourceName}
        </ThemedText>
      </Pressable>
      <View style={styles.votes}>
        <VoteGroup
          label="Accurate?"
          voted={c.votedAccurate}
          yes={c.accurateYes}
          no={c.accurateNo}
          onVote={(v) => vote('accurate', v)}
        />
        <VoteGroup
          label="Approve?"
          voted={c.votedApprove}
          yes={c.approveYes}
          no={c.approveNo}
          onVote={(v) => vote('approve', v)}
        />
      </View>
      <ThemedText type="caption" themeColor="textSecondary">
        {accVotes > 0
          ? `Counts with strength ${c.strength.toFixed(2)} (${accVotes} accuracy vote${accVotes === 1 ? '' : 's'}). Approval is shown, not scored.`
          : 'No accuracy votes yet, so it doesn’t affect the score.'}
      </ThemedText>
      {/* Opt-in: the perspectives are never shown unless you choose to open them. */}
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push({ pathname: '/perspectives', params: { citation: c.id } })}
      >
        <ThemedText type="caption" themeColor="textSecondary" style={styles.optIn}>
          Does this citation offend you?
        </ThemedText>
      </Pressable>
      <ErrorText message={error} />
    </View>
  );
}

function VoteGroup({
  label,
  voted,
  yes,
  no,
  onVote,
}: {
  label: string;
  voted: boolean;
  yes: number;
  no: number;
  onVote: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.group}>
      <ThemedText type="caption" style={{ fontWeight: 800 }}>
        {label}
      </ThemedText>
      {voted ? (
        <ThemedText type="caption" themeColor="textSecondary">
          Yes {yes} · No {no}
        </ThemedText>
      ) : (
        <View style={styles.buttons}>
          {[true, false].map((v) => (
            <Pressable
              key={String(v)}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${v ? 'Yes' : 'No'}`}
              onPress={() => onVote(v)}
              style={({ pressed }) => [
                styles.vote,
                { backgroundColor: theme.backgroundSelected },
                pressed && { opacity: 0.7 },
              ]}
            >
              <ThemedText type="caption" style={{ fontWeight: 800 }}>
                {v ? 'Yes' : 'No'}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  optIn: { textDecorationLine: 'underline' },
  wrap: { gap: Spacing.two, marginTop: Spacing.two },
  card: { borderLeftWidth: 3, borderRadius: Radius.small, padding: Spacing.two, gap: 4 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  votes: { flexDirection: 'row', gap: Spacing.four, flexWrap: 'wrap' },
  group: { gap: 2 },
  buttons: { flexDirection: 'row', gap: Spacing.one + 2 },
  vote: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two + 2, paddingVertical: 3 },
});
