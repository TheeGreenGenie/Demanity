import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chips } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { parsePastDate } from '@/lib/validation';

/**
 * Add a citation about a leader (contributors, moderators, or leaders citing
 * others). It goes to moderators for review before it counts.
 */
export default function CiteScreen() {
  const { slug, category } = useLocalSearchParams<{ slug: string; category: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { token } = useAuth();
  const [direction, setDirection] = useState<'positive' | 'negative'>('positive');
  const [claim, setClaim] = useState('');
  const [url, setUrl] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState<{ claim?: string; url?: string; date?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [sources, setSources] = useState<string[]>([]);

  useEffect(() => {
    civic
      .sources()
      .then((r) => setSources(r.sources.map((s) => s.name)))
      .catch(() => undefined);
  }, []);

  async function submit() {
    const actionDate = parsePastDate(date);
    const next = {
      ...(claim.trim().length < 10
        ? { claim: 'Describe the action in at least 10 characters.' }
        : {}),
      ...(!/^https?:\/\/\S+$/.test(url.trim())
        ? { url: 'Paste the full link, starting with https://' }
        : {}),
      ...(!actionDate ? { date: 'Use MM/DD/YYYY, and not a future date.' } : {}),
    };
    setErrors(next);
    if (Object.keys(next).length > 0 || !token) return;
    setBusy(true);
    setError(null);
    try {
      await civic.submitCitation(token, slug, {
        category,
        direction,
        claim: claim.trim(),
        sourceUrl: url.trim(),
        actionDate: actionDate!,
      });
      setDone(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <Screen title="Sent for review" subtitle="A moderator will check the source and the claim.">
        <ThemedText themeColor="textSecondary">
          Once accepted, members can rate it “Accurate?”, and it starts counting toward the score in
          the next update (within a few minutes).
        </ThemedText>
        <Button title="Back to the leader" onPress={() => router.back()} />
      </Screen>
    );

  return (
    <Screen title="Add a citation" subtitle={`Topic: c/${category}`}>
      <Chips
        label="Direction"
        value={direction}
        onChange={setDirection}
        options={[
          { key: 'positive', label: 'Positive', icon: 'thumbs-up-outline' },
          { key: 'negative', label: 'Negative', icon: 'thumbs-down-outline' },
        ]}
      />
      <Field
        label="What did they do?"
        placeholder="e.g. Voted for the community clinic funding bill"
        value={claim}
        onChangeText={setClaim}
        multiline
        maxLength={1000}
        error={errors.claim}
      />
      <Field
        label="Source link"
        placeholder="https://www.congress.gov/…"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        keyboardType="url"
        error={errors.url}
      />
      <Field
        label="When did it happen?"
        placeholder="MM/DD/YYYY"
        value={date}
        onChangeText={setDate}
        error={errors.date}
      />
      <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="caption" themeColor="textSecondary">
          Every factual claim needs an approved source:{' '}
          {sources.length
            ? sources.join(', ')
            : 'official .gov sites, court records, AP, Reuters, C-SPAN'}
          . Leaders can’t cite themselves; contributors’ names are never shown.
        </ThemedText>
      </View>
      <ErrorText message={error} />
      <Button title="Submit for review" onPress={submit} busy={busy} />
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push({ pathname: '/contribute', params: { category } })}
      >
        <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
          Not a contributor yet? Apply with a short essay →
        </ThemedText>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { borderRadius: Radius.medium, padding: Spacing.three - 4 },
});
