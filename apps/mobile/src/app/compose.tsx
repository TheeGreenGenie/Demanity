import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError, social, type Community } from '@/lib/api';
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

  useEffect(() => {
    social
      .communities(token)
      .then((r) => setCommunities(r.communities))
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (ready && !isFullyOnboarded(me)) router.replace('/join');
  }, [ready, me, router]);

  const valid = slug !== '' && title.trim().length >= 3 && body.trim().length >= 1;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const post = await social.createPost(token!, slug, title.trim(), body.trim());
      router.replace({ pathname: '/post/[id]', params: { id: post.id } });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="New post">
      <ThemedText type="smallBold">Community</ThemedText>
      <View style={styles.chips}>
        {communities.map((c) => {
          const active = c.slug === slug;
          return (
            <Pressable
              key={c.slug}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setSlug(c.slug)}
              style={[
                styles.chip,
                { borderColor: active ? Brand.primary : theme.backgroundSelected },
                active && { backgroundColor: Brand.primary },
              ]}
            >
              <ThemedText type="small" style={active ? { color: Brand.onPrimary } : undefined}>
                {c.name}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={200} />
      <Field
        label="What's on your mind?"
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={20000}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Be civil. Factual claims should cite a source. Clear misinformation, hate and harassment are
        removed, and every removal is listed in the public moderation log.
      </ThemedText>
      <ErrorText message={error} />
      <Button title="Post" onPress={submit} busy={busy} disabled={!valid} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
});
