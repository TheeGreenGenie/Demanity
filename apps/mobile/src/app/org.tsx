import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TallyBar } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { timeAgo } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { community, describeError, type OrgProposal } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

/**
 * Demanity's own decisions, put to members (R22). Votes are advisory; once a
 * proposal reaches the threshold, Demanity must respond publicly.
 */
export default function OrgScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const member = isFullyOnboarded(me) && token !== null;
  const [data, setData] = useState<{ threshold: number; proposals: OrgProposal[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    community
      .orgProposals(token)
      .then(setData)
      .catch((err) => setError(describeError(err)));
  }, [token]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      load();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Screen
      title="Demanity’s decisions"
      subtitle={`Members weigh in on how Demanity is run. Votes are advisory; at ${data?.threshold ?? 100} votes we must respond publicly.`}
    >
      <ErrorText message={error} />
      {data && data.proposals.length === 0 ? (
        <ThemedText themeColor="textSecondary">No proposals yet.</ThemedText>
      ) : null}
      {(data?.proposals ?? []).map((p) => (
        <View key={p.id} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
            {p.status === 'responded'
              ? 'RESPONDED'
              : p.responseRequired
                ? 'RESPONSE REQUIRED'
                : 'OPEN'}{' '}
            · {timeAgo(p.createdAt)}
          </ThemedText>
          <ThemedText type="headline">{p.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {p.body}
          </ThemedText>
          {p.tally ? (
            <TallyBar tally={p.tally} />
          ) : p.status === 'open' ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button
                  title="Oppose"
                  variant="secondary"
                  size="small"
                  onPress={() =>
                    member
                      ? act(() => community.voteOrg(token!, p.id, 'oppose'))
                      : router.push('/join')
                  }
                />
              </View>
              <View style={styles.flex}>
                <Button
                  title={member ? 'Support' : 'Join to vote'}
                  size="small"
                  onPress={() =>
                    member
                      ? act(() => community.voteOrg(token!, p.id, 'support'))
                      : router.push('/join')
                  }
                />
              </View>
            </View>
          ) : null}
          {p.response ? (
            <View style={[styles.response, { borderLeftColor: Brand.primary }]}>
              <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
                DEMANITY RESPONDED{p.respondedAt ? ` · ${timeAgo(p.respondedAt)}` : ''}
              </ThemedText>
              <ThemedText type="small">{p.response}</ThemedText>
            </View>
          ) : null}
          {me?.moderator && p.status === 'open' ? (
            <View style={styles.form}>
              <Field
                label="Official response"
                value={replies[p.id] ?? ''}
                onChangeText={(v) => setReplies((r) => ({ ...r, [p.id]: v }))}
                multiline
              />
              <Button
                title="Publish response"
                size="small"
                variant="secondary"
                onPress={() =>
                  act(() => community.respondOrg(token!, p.id, (replies[p.id] ?? '').trim()))
                }
              />
            </View>
          ) : null}
        </View>
      ))}
      {me?.moderator ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="headline">Post a proposal</ThemedText>
          <Field label="Title" value={title} onChangeText={setTitle} maxLength={200} />
          <Field label="Details" value={body} onChangeText={setBody} multiline maxLength={6000} />
          <Button
            title="Post to members"
            onPress={() =>
              act(async () => {
                await community.postOrg(token!, title.trim(), body.trim());
                setTitle('');
                setBody('');
              })
            }
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.two },
  card: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  response: { borderLeftWidth: 3, paddingLeft: Spacing.two, gap: 2 },
  form: { gap: Spacing.two },
});
