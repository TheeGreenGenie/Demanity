import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Chips, Section } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError, social, type Community, type ContributorStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const MIN = 300;
const MAX = 6000;
const STATUS_LABEL = { pending: 'Under review', approved: 'Approved', rejected: 'Not approved' };

/**
 * Apply to be a contributor in one topic. Contributors add sourced citations
 * about leaders (shown without their name); moderators review the essay
 * without seeing who wrote it. Approval lasts a year, then you re-apply.
 */
export default function ContributeScreen() {
  const params = useLocalSearchParams<{ category?: string }>();
  const theme = useTheme();
  const { token } = useAuth();
  const [topics, setTopics] = useState<Community[]>([]);
  const [category, setCategory] = useState(params.category ?? 'health');
  const [essay, setEssay] = useState('');
  const [essayError, setEssayError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ContributorStatus | null>(null);

  const loadStatus = () => {
    if (token)
      civic
        .myContributor(token)
        .then(setStatus)
        .catch(() => undefined);
  };
  useEffect(() => {
    social
      .communities(null, 'topic')
      .then((r) => setTopics(r.communities))
      .catch(() => undefined);
    if (token)
      civic
        .myContributor(token)
        .then(setStatus)
        .catch(() => undefined);
  }, [token]);

  async function submit() {
    const text = essay.trim();
    if (text.length < MIN)
      return setEssayError(`Write at least ${MIN} characters (${text.length} so far).`);
    setEssayError(undefined);
    setBusy(true);
    setError(null);
    try {
      await civic.applyToContribute(token!, category, text);
      setEssay('');
      loadStatus();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Become a contributor"
      subtitle="Contributors add sourced citations about leaders in one topic."
    >
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">How it works</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          1. Pick a topic and write a short essay on what’s happening in it right now. Cite official
          sources for facts.{'\n'}2. Moderators review the essay without seeing your name.{'\n'}3.
          If approved, you can add citations in that topic for one year. Your name is never shown on
          them.
        </ThemedText>
      </View>

      <Section title="Topic" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Chips
          label="Topic"
          value={category}
          onChange={setCategory}
          options={topics.map((t) => ({ key: t.slug, label: t.name }))}
        />
      </ScrollView>

      <Field
        label="Your essay"
        placeholder="What are the most important current facts and debates in this topic? Cite sources."
        value={essay}
        onChangeText={setEssay}
        multiline
        maxLength={MAX}
        error={essayError}
        hint={`${essay.trim().length} / ${MIN} characters minimum`}
      />
      <ErrorText message={error} />
      <Button title="Submit application" onPress={submit} busy={busy} />

      {status && (status.grants.length > 0 || status.applications.length > 0) ? (
        <View style={styles.status}>
          <ThemedText type="headline">Your status</ThemedText>
          {status.grants.map((g) => (
            <ThemedText key={g.category} type="small">
              <ThemedText type="small" style={{ color: Brand.like, fontWeight: 800 }}>
                Contributor
              </ThemedText>{' '}
              in {g.categoryName} until {new Date(g.expiresAt).toLocaleDateString('en-US')}
            </ThemedText>
          ))}
          {status.applications.map((a) => (
            <ThemedText key={a.id} type="small" themeColor="textSecondary">
              {a.categoryName}: {STATUS_LABEL[a.status]}
              {a.reasonCode && a.status === 'rejected'
                ? ` (${a.reasonCode.replace(/_/g, ' ')})`
                : ''}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  status: { gap: Spacing.one + 2 },
});
