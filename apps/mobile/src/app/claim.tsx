import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * A leader claims their page. Moderators confirm it through an official
 * channel before linking the account. The evidence is never shown publicly.
 */
export default function ClaimScreen() {
  const { slug, name } = useLocalSearchParams<{ slug: string; name?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { token } = useAuth();
  const [evidence, setEvidence] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (evidence.trim().length < 20)
      return setFieldError('Give moderators a way to confirm it’s you (at least 20 characters).');
    setFieldError(undefined);
    setBusy(true);
    setError(null);
    try {
      await civic.claimLeader(token!, slug, evidence.trim());
      setDone(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <Screen title="Claim submitted" subtitle="A moderator will contact you through an official channel.">
        <Button title="Back" onPress={() => router.back()} />
      </Screen>
    );

  return (
    <Screen title={`Claim ${name ?? 'this page'}`} subtitle="For the officeholder or their official staff.">
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Once confirmed, you can post as yourself, answer people’s requests, and cite other leaders
          under your name. You can’t edit your trust page or cite yourself; scores come only from
          reviewed citations.
        </ThemedText>
      </View>
      <Field
        label="How can we confirm it’s you?"
        placeholder="e.g. Email me at my official .gov address, or call the office number on my official site"
        value={evidence}
        onChangeText={setEvidence}
        multiline
        maxLength={2000}
        error={fieldError}
        hint="Only moderators see this."
      />
      <ErrorText message={error} />
      <Button title="Submit claim" onPress={submit} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.medium, padding: Spacing.three },
});
