import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Chips } from '@/components/civic';
import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError, type PendingCitation } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Published reason codes (apps/api/src/moderation/reasons.ts). */
const REJECT_REASONS = [
  { key: 'source_does_not_support_claim', label: 'Source doesn’t support it' },
  { key: 'not_an_approved_source', label: 'Not an approved source' },
  { key: 'duplicate_citation', label: 'Duplicate' },
  { key: 'wrong_category', label: 'Wrong topic' },
  { key: 'other_policy_violation', label: 'Other policy violation' },
] as const;

/**
 * Moderator review queue for citations. Every decision cites a published
 * reason code and appears in the public moderation log. The server refuses
 * decisions on your own submissions.
 */
export default function ModerationScreen() {
  const { token } = useAuth();
  const [items, setItems] = useState<PendingCitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    civic
      .pendingCitations(token)
      .then((r) => setItems(r.citations))
      .catch((err) => setError(describeError(err)));
  }, [token]);
  useEffect(load, [load]);

  return (
    <Screen title="Review citations" subtitle="Check that the source supports the claim.">
      <ErrorText message={error} />
      {items && items.length === 0 ? (
        <ThemedText themeColor="textSecondary">Nothing waiting for review.</ThemedText>
      ) : null}
      {(items ?? []).map((c) => (
        <ReviewCard key={c.id} citation={c} onDone={load} />
      ))}
    </Screen>
  );
}

function ReviewCard({ citation, onDone }: { citation: PendingCitation; onDone: () => void }) {
  const theme = useTheme();
  const { token } = useAuth();
  const [reason, setReason] = useState<(typeof REJECT_REASONS)[number]['key']>(
    'source_does_not_support_claim',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'accept' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      await civic.decideCitation(
        token!,
        citation.id,
        decision,
        decision === 'accept' ? 'source_verified' : reason,
      );
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const positive = citation.direction === 'positive';
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText
        type="caption"
        style={{ color: positive ? Brand.like : Brand.dislike, fontWeight: 900 }}
      >
        {positive ? 'POSITIVE' : 'NEGATIVE'} · {citation.leaderName} · c/{citation.categorySlug}
        {citation.byLeader ? ' · submitted by a leader' : ''}
      </ThemedText>
      <ThemedText>{citation.claim}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        Action date {String(citation.actionDate).slice(0, 10)} · source {citation.sourceDomain}
      </ThemedText>
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(citation.sourceUrl)}>
        <ThemedText type="small" style={{ color: Brand.primary }} numberOfLines={1}>
          Open the source →
        </ThemedText>
      </Pressable>
      <Chips
        label="Reason for rejecting"
        value={reason}
        onChange={setReason}
        options={REJECT_REASONS}
      />
      <ErrorText message={error} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title="Reject" variant="secondary" onPress={() => decide('reject')} busy={busy} />
        </View>
        <View style={styles.flex}>
          <Button title="Accept" onPress={() => decide('accept')} busy={busy} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
});
