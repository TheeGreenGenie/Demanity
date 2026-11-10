import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { timeAgo } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError, moderation, type LogEntry } from '@/lib/api';

/** Plain-language labels for logged actions. */
const ACTIONS: Record<string, string> = {
  'post.removed': 'Removed a post',
  'comment.removed': 'Removed a comment',
  'account.banned': 'Banned an account',
  'account.ban_proposed': 'Proposed a ban (needs a second moderator)',
  'verification.approved': 'Approved a verification',
  'verification.denied': 'Denied a verification',
  'verification.deny_proposed': 'Proposed a verification denial (needs a second moderator)',
  'citation.accepted': 'Accepted a citation',
  'citation.rejected': 'Rejected a citation',
  'contributor.granted': 'Approved a contributor',
  'contributor.revoked': 'Revoked a contributor',
  'contributor_application.approved': 'Approved a contributor application',
  'contributor_application.rejected': 'Rejected a contributor application',
  'leader_claim.approved': 'Confirmed a leader’s page claim',
  'leader_claim.rejected': 'Rejected a leader page claim',
  'appeal.upheld': 'Upheld an appeal (decision reversed)',
  'appeal.denied': 'Denied an appeal',
  'request.done': 'Marked a leader request done',
  'request.removed': 'Removed a leader request',
  'request.merged': 'Merged a duplicate request',
};
const label = (a: string) =>
  ACTIONS[a] ??
  (a.startsWith('context_note.added_to_')
    ? `Added a context note to a ${a.replace('context_note.added_to_', '')}`
    : a.replace(/[._]/g, ' '));

/**
 * The public, append-only moderation log (R10, R28). Every moderator action
 * appears here with its published reason. Moderators are never named.
 */
export default function LogScreen() {
  const theme = useTheme();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(true);

  useEffect(() => {
    moderation
      .log()
      .then((r) => {
        setEntries(r.entries);
        setMore(r.entries.length === 50);
      })
      .catch((err) => setError(describeError(err)));
  }, []);

  async function loadMore() {
    const last = entries[entries.length - 1];
    if (!last) return;
    const r = await moderation.log(last.id);
    setEntries((e) => [...e, ...r.entries]);
    setMore(r.entries.length === 50);
  }

  return (
    <Screen
      title="Moderation log"
      subtitle="Every moderator action, with its published reason. Append-only; moderators aren’t named."
    >
      <ErrorText message={error} />
      {entries.length === 0 && !error ? (
        <ThemedText themeColor="textSecondary">No moderator actions yet.</ThemedText>
      ) : null}
      {entries.map((e) => (
        <View key={e.id} style={[styles.row, { borderBottomColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">
            {label(e.action)}
            {e.target_username ? ` · u/${e.target_username}` : ''}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            Reason:{' '}
            <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
              {e.reason_code.replace(/_/g, ' ')}
            </ThemedText>{' '}
            · {timeAgo(e.created_at)} · #{e.id}
          </ThemedText>
        </View>
      ))}
      {more && entries.length > 0 ? (
        <Button title="Load older" variant="secondary" onPress={loadMore} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
});
