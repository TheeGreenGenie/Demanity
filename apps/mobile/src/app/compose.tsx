import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { communityColor } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { community, describeError, social, type Community } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

export default function ComposeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { ready, token, me } = useAuth();
  const params = useLocalSearchParams<{ community?: string }>();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [slug, setSlug] = useState(params.community ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [withPoll, setWithPoll] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  useEffect(() => {
    social
      .communities(token)
      .then((r) => setCommunities(r.communities))
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (ready && !isFullyOnboarded(me)) router.replace('/join');
  }, [ready, me, router]);

  // Never a silently disabled button: problems are named next to their field.
  const problems = {
    community: slug === '' ? 'Pick a community for your post.' : undefined,
    title: title.trim().length < 3 ? 'Give your post a title (at least 3 characters).' : undefined,
    body: body.trim().length < 1 ? 'Write something for your post.' : undefined,
    poll:
      withPoll && (question.trim().length < 5 || options.filter((o) => o.trim()).length < 2)
        ? 'A poll needs a question (5+ characters) and at least 2 options.'
        : undefined,
  };
  const shown = attempted ? problems : { community: undefined, title: undefined, body: undefined };

  async function submit() {
    setAttempted(true);
    if (problems.community || problems.title || problems.body || problems.poll) return;
    setBusy(true);
    setError(null);
    try {
      const post = await social.createPost(token!, slug, title.trim(), body.trim());
      if (withPoll)
        await community.addPoll(
          token!,
          post.id,
          question.trim(),
          options.map((o) => o.trim()).filter(Boolean),
        );
      router.replace({ pathname: '/post/[id]', params: { id: post.id } });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.who}>
        <Avatar name={me?.username ?? null} size={36} />
        <ThemedText type="smallBold">{me?.username}</ThemedText>
      </View>

      <ThemedText type="smallBold" themeColor="textSecondary">
        Post to
      </ThemedText>
      <View style={styles.chips}>
        {communities.map((c) => {
          const active = c.slug === slug;
          const color = communityColor(c.kind);
          return (
            <Pressable
              key={c.slug}
              accessibilityRole="radio"
              accessibilityLabel={c.name}
              accessibilityState={{ selected: active }}
              onPress={() => setSlug(c.slug)}
              style={[
                styles.chip,
                { borderColor: active ? color : theme.backgroundSelected },
                active && { backgroundColor: color },
              ]}
            >
              <ThemedText type="caption" style={[styles.chipText, active && { color: '#fff' }]}>
                {c.name}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {shown.community ? <ErrorText message={shown.community} /> : null}

      <Field
        label="Title"
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        error={shown.title}
      />
      <Field
        label="What's on your mind?"
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={20000}
        error={shown.body}
      />
      <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="caption" themeColor="textSecondary">
          Be civil. Factual claims should cite a source. Clear misinformation, hate and harassment
          are removed, and every removal is listed in the public moderation log.
        </ThemedText>
      </View>
      <ErrorText message={error} />
      <Button
        title={withPoll ? 'Remove poll' : 'Add a poll'}
        variant="ghost"
        size="small"
        onPress={() => setWithPoll((w) => !w)}
      />
      {withPoll ? (
        <View style={{ gap: 8 }}>
          <Field
            label="Poll question"
            value={question}
            onChangeText={setQuestion}
            maxLength={300}
          />
          {options.map((o, i) => (
            <Field
              key={i}
              label={`Option ${i + 1}`}
              value={o}
              onChangeText={(v) => setOptions((list) => list.map((x, j) => (j === i ? v : x)))}
              maxLength={120}
            />
          ))}
          {options.length < 6 ? (
            <Button
              title="Add option"
              variant="ghost"
              size="small"
              onPress={() => setOptions((list) => [...list, ''])}
            />
          ) : null}
          {attempted && problems.poll ? <ErrorText message={problems.poll} /> : null}
          <ThemedText type="caption" themeColor="textSecondary">
            Votes are private and results show after voting. Polls close in 7 days.
          </ThemedText>
        </View>
      ) : null}
      <Button title="Post" onPress={submit} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.one + 2,
  },
  chipText: { fontWeight: 700 },
  note: {
    borderRadius: Radius.medium,
    padding: Spacing.three - 4,
    borderLeftWidth: 3,
    borderLeftColor: Brand.primary,
  },
});
