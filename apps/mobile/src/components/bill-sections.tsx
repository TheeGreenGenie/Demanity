import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Section } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { ForumPostCard } from '@/components/forum';
import { Empty } from '@/components/place-sections';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bills, describeError, type BillAction, type Post } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

/** Official action history, newest first (from the bill's source). */
export function BillTimeline({ billId }: { billId: string }) {
  const theme = useTheme();
  const [actions, setActions] = useState<BillAction[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    bills
      .timeline(billId)
      .then((r) => setActions(r.actions))
      .catch(() => setActions([]));
  }, [billId]);
  if (!actions) return null;
  const shown = showAll ? actions : actions.slice(0, 5);
  return (
    <Section title="Timeline" caption="Official actions, newest first">
      {actions.length === 0 ? <Empty text="No actions recorded yet." /> : null}
      <View style={styles.timeline}>
        {shown.map((a, i) => (
          <View key={`${a.date}-${i}`} style={styles.step}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: i === 0 ? Brand.primary : theme.backgroundSelected },
                ]}
              />
              {i < shown.length - 1 ? (
                <View style={[styles.line, { backgroundColor: theme.backgroundSelected }]} />
              ) : null}
            </View>
            <View style={styles.stepBody}>
              <ThemedText type="caption" themeColor="textSecondary">
                {a.date}
              </ThemedText>
              <ThemedText type="small">{a.text}</ThemedText>
            </View>
          </View>
        ))}
      </View>
      {actions.length > 5 ? (
        <View style={styles.pad}>
          <Button
            title={showAll ? 'Show fewer' : `Show all ${actions.length} actions`}
            variant="ghost"
            size="small"
            onPress={() => setShowAll((s) => !s)}
          />
        </View>
      ) : null}
    </Section>
  );
}

/** The bill's discussion: posts linked to it, and a composer for members. */
export function BillDiscussion({ billId }: { billId: string }) {
  const router = useRouter();
  const { token, me } = useAuth();
  const member = isFullyOnboarded(me) && token !== null;
  const [posts, setPosts] = useState<Post[]>([]);
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    bills
      .posts(token, billId)
      .then((r) => setPosts(r.posts))
      .catch(() => undefined);
  useEffect(() => {
    bills
      .posts(token, billId)
      .then((r) => setPosts(r.posts))
      .catch(() => undefined);
  }, [token, billId]);

  async function submit() {
    if (title.trim().length < 3 || !body.trim()) return setError('Add a title and some text.');
    setBusy(true);
    setError(null);
    try {
      await bills.createPost(token!, billId, title.trim(), body.trim());
      setTitle('');
      setBody('');
      setWriting(false);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Discussion" caption="Debate the bill. Cite sources for facts.">
      {posts.length === 0 ? <Empty text="No discussion yet. Start it." /> : null}
      {posts.map((p) => (
        <ForumPostCard key={p.id} post={p} />
      ))}
      <View style={styles.pad}>
        {writing ? (
          <View style={styles.form}>
            <Field label="Title" value={title} onChangeText={setTitle} maxLength={200} />
            <Field
              label="What do you think?"
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={20000}
            />
            <ErrorText message={error} />
            <Button title="Post" onPress={submit} busy={busy} />
          </View>
        ) : (
          <Button
            title={member ? 'Start a discussion' : 'Join to discuss'}
            variant="secondary"
            onPress={() => (member ? setWriting(true) : router.push('/join'))}
          />
        )}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: Spacing.three },
  form: { gap: Spacing.two },
  timeline: { paddingHorizontal: Spacing.three },
  step: { flexDirection: 'row', gap: Spacing.two },
  rail: { width: 14, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  line: { width: 2, flex: 1, marginTop: 2 },
  stepBody: { flex: 1, paddingBottom: Spacing.three - 4, gap: 2 },
});
