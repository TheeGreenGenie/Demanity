import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Chips, Section } from '@/components/civic';
import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  civic,
  describeError,
  type PendingApplication,
  type PendingCitation,
  type PendingAppeal,
  type PendingClaim,
  moderation,
} from '@/lib/api';
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
  const router = useRouter();
  const { token } = useAuth();
  const [items, setItems] = useState<PendingCitation[] | null>(null);
  const [apps, setApps] = useState<PendingApplication[]>([]);
  const [claims, setClaims] = useState<PendingClaim[]>([]);
  const [appeals, setAppeals] = useState<PendingAppeal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    civic
      .pendingCitations(token)
      .then((r) => setItems(r.citations))
      .catch((err) => setError(describeError(err)));
    civic
      .pendingApplications(token)
      .then((r) => setApps(r.applications))
      .catch(() => undefined);
    civic
      .pendingClaims(token)
      .then((r) => setClaims(r.claims))
      .catch(() => undefined);
    moderation
      .pendingAppeals(token)
      .then((r) => setAppeals(r.appeals))
      .catch(() => undefined);
  }, [token]);
  useEffect(load, [load]);

  return (
    <Screen title="Moderation" subtitle="Every decision cites a reason and is publicly logged.">
      <ErrorText message={error} />
      <Button
        title="Open the public moderation log"
        variant="ghost"
        onPress={() => router.push('/log')}
      />
      <Section
        title={`Citations (${items?.length ?? 0})`}
        caption="Check that the source supports the claim."
      />
      {items && items.length === 0 ? (
        <ThemedText themeColor="textSecondary">Nothing waiting for review.</ThemedText>
      ) : null}
      {(items ?? []).map((c) => (
        <ReviewCard key={c.id} citation={c} onDone={load} />
      ))}
      <Section
        title={`Contributor applications (${apps.length})`}
        caption="Judge the essay, not the person: applicants are anonymous to you."
      />
      {apps.map((a) => (
        <DecisionCard
          key={a.id}
          heading={`c/${a.category}`}
          body={a.essay}
          approveReason="essay_approved"
          rejectReasons={APP_REJECT}
          onDecide={(d, reason) => civic.decideApplication(token!, a.id, d, reason)}
          onDone={load}
        />
      ))}
      <Section
        title={`Appeals (${appeals.length})`}
        caption="You can't decide an appeal against your own decision."
      />
      {appeals.map((a) => (
        <DecisionCard
          key={a.id}
          heading={`Appeal of a ${a.targetType.replace('_', ' ')}${a.yourDecision ? ' · your decision (another moderator must review)' : ''}`}
          body={a.statement}
          approveReason={
            a.targetType === 'context_note' ? 'note_not_supported' : 'removal_not_justified'
          }
          approveLabel="Uphold (reverse)"
          rejectLabel="Deny"
          rejectReasons={a.targetType === 'context_note' ? APPEAL_DENY_NOTE : APPEAL_DENY_REMOVAL}
          onDecide={(d, reason) =>
            moderation.decideAppeal(token!, a.id, d === 'approve' ? 'uphold' : 'deny', reason)
          }
          onDone={load}
        />
      ))}
      <Section
        title={`Leader page claims (${claims.length})`}
        caption="Confirm through an official channel (e.g. the official .gov email) before approving."
      />
      {claims.map((c) => (
        <DecisionCard
          key={c.id}
          heading={`${c.leaderName} · ${c.office} · claimed by u/${c.username}`}
          body={c.evidence}
          approveReason="identity_confirmed_official_channel"
          rejectReasons={CLAIM_REJECT}
          onDecide={(d, reason) => civic.decideClaim(token!, c.id, d, reason)}
          onDone={load}
        />
      ))}
    </Screen>
  );
}

const APP_REJECT = [
  { key: 'essay_insufficient', label: 'Not enough substance' },
  { key: 'essay_not_original', label: 'Not original' },
  { key: 'other_policy_violation', label: 'Other policy violation' },
] as const;
const APPEAL_DENY_REMOVAL = [{ key: 'removal_justified', label: 'Removal was justified' }] as const;
const APPEAL_DENY_NOTE = [{ key: 'note_supported', label: 'Note is supported' }] as const;
const CLAIM_REJECT = [
  { key: 'identity_not_confirmed', label: 'Couldn’t confirm' },
  { key: 'not_the_officeholder', label: 'Not the officeholder' },
  { key: 'other_policy_violation', label: 'Other policy violation' },
] as const;

/** Approve / reject with a published reason (applications and claims). */
function DecisionCard({
  heading,
  body,
  approveReason,
  rejectReasons,
  onDecide,
  onDone,
  approveLabel = 'Approve',
  rejectLabel = 'Reject',
}: {
  heading: string;
  body: string;
  approveReason: string;
  approveLabel?: string;
  rejectLabel?: string;
  rejectReasons: readonly { key: string; label: string }[];
  onDecide: (decision: 'approve' | 'reject', reason: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const theme = useTheme();
  const [reason, setReason] = useState<string>(rejectReasons[0]!.key);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function decide(d: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      await onDecide(d, d === 'approve' ? approveReason : reason);
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
        {heading}
      </ThemedText>
      <ThemedText type="small">{body}</ThemedText>
      <Chips
        label="Reason for rejecting"
        value={reason}
        onChange={setReason}
        options={rejectReasons}
      />
      <ErrorText message={error} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            title={rejectLabel}
            variant="secondary"
            onPress={() => decide('reject')}
            busy={busy}
          />
        </View>
        <View style={styles.flex}>
          <Button title={approveLabel} onPress={() => decide('approve')} busy={busy} />
        </View>
      </View>
    </View>
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
