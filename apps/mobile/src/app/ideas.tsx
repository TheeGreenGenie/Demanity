import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chips, Section } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { timeAgo } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bills, describeError, type Contribution } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

/**
 * Member bill ideas (R24): ideas members want lawmakers to take up, most
 * supported first, plus a form to suggest an idea or report legislation our
 * feeds missed. Everything is reviewed by moderators before it appears.
 */
export default function IdeasScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const member = isFullyOnboarded(me) && token !== null;
  const [ideas, setIdeas] = useState<Contribution[]>([]);
  const [kind, setKind] = useState<'bill_idea' | 'missing_item'>('bill_idea');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(() => {
    bills
      .contributions(token, 'bill_idea')
      .then((r) => setIdeas(r.contributions))
      .catch(() => undefined);
  }, [token]);
  useEffect(load, [load]);

  async function submit() {
    if (!member) return router.push('/join');
    if (title.trim().length < 5 || body.trim().length < 20)
      return setError('Add a title (5+ characters) and a description (20+ characters).');
    if (kind === 'missing_item' && !/^https?:\/\//.test(url.trim()))
      return setError('Missing items need a link to an official source.');
    setError(null);
    try {
      await bills.contribute(token!, {
        kind,
        title: title.trim(),
        body: body.trim(),
        ...(kind === 'missing_item' ? { sourceUrl: url.trim() } : {}),
      });
      setTitle('');
      setBody('');
      setUrl('');
      setSent(true);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function toggle(c: Contribution) {
    if (!member) return router.push('/join');
    setIdeas((list) =>
      list.map((x) =>
        x.id === c.id ? { ...x, myVote: !x.myVote, votes: x.votes + (x.myVote ? -1 : 1) } : x,
      ),
    );
    try {
      await bills.voteIdea(token!, c.id, !c.myVote);
    } catch {
      load();
    }
  }

  return (
    <Screen title="Member bill ideas" subtitle="Ideas members want lawmakers to take up.">
      {ideas.length === 0 ? (
        <ThemedText themeColor="textSecondary">
          No approved ideas yet. Suggest the first.
        </ThemedText>
      ) : null}
      {ideas.map((c) => (
        <View key={c.id} style={[styles.idea, { borderBottomColor: theme.backgroundSelected }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Support (${c.votes})`}
            accessibilityState={{ selected: c.myVote }}
            onPress={() => toggle(c)}
            style={[
              styles.vote,
              { backgroundColor: c.myVote ? Brand.primary : theme.backgroundElement },
            ]}
          >
            <Ionicons name="arrow-up" size={18} color={c.myVote ? '#fff' : theme.text} />
            <ThemedText type="smallBold" style={c.myVote ? { color: '#fff' } : undefined}>
              {c.votes}
            </ThemedText>
          </Pressable>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{c.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {c.body}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {c.categoryName ? `${c.categoryName} · ` : ''}
              {c.author ? `u/${c.author.username}` : 'deleted'} · {timeAgo(c.createdAt)}
            </ThemedText>
          </View>
        </View>
      ))}

      <Section title="Suggest something" caption="Moderators review every suggestion first." />
      <Chips
        label="What are you suggesting?"
        value={kind}
        onChange={setKind}
        options={[
          { key: 'bill_idea', label: 'A bill idea', icon: 'bulb-outline' },
          { key: 'missing_item', label: 'Missing legislation', icon: 'search-outline' },
        ]}
      />
      {sent ? (
        <ThemedText type="small" style={{ color: Brand.like, fontWeight: 700 }}>
          Thanks! A moderator will review it.
        </ThemedText>
      ) : null}
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={200} />
      <Field
        label={kind === 'bill_idea' ? 'What should the law do?' : 'What did we miss?'}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={4000}
      />
      {kind === 'missing_item' ? (
        <Field
          label="Official source link"
          placeholder="https://… (.gov, court record, AP, Reuters, C-SPAN)"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
        />
      ) : null}
      <ErrorText message={error} />
      <Button title={member ? 'Submit for review' : 'Join to suggest'} onPress={submit} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  idea: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  vote: {
    width: 52,
    alignItems: 'center',
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    alignSelf: 'flex-start',
  },
});
