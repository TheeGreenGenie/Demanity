import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { SampleBanner, Section } from '@/components/civic';
import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError, type Election } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

/**
 * An upcoming election: candidates, a private mock ballot, and links to
 * register and learn. Mock results show only after you cast yours.
 */
export default function ElectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const member = isFullyOnboarded(me) && token !== null;
  const [election, setElection] = useState<Election | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  const load = () =>
    civic
      .election(token, id)
      .then(setElection)
      .catch((err) => setError(describeError(err)));
  useEffect(() => {
    civic
      .election(token, id)
      .then(setElection)
      .catch((err) => setError(describeError(err)));
  }, [token, id]);

  async function cast() {
    if (!member) return router.push('/join');
    if (!choice) return setError('Pick a candidate first.');
    if (!attested) return setError('Confirm that you vote in this election.');
    setBusy(true);
    setError(null);
    try {
      await civic.castMockBallot(token!, id, choice);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!election) return <Screen>{error ? <ErrorText message={error} /> : null}</Screen>;
  const date = new Date(`${election.electionDate}T12:00:00Z`);
  const days = Math.ceil((date.getTime() - now) / 86_400_000);
  const showResults = election.total !== null;

  return (
    <Screen>
      {election.isSample ? (
        <SampleBanner what="this election's candidates are fictional and its date is illustrative" />
      ) : null}
      <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
        {election.kind.toUpperCase()} ELECTION · {election.place.name.toUpperCase()}
      </ThemedText>
      <ThemedText type="subtitle">{election.office}</ThemedText>
      <ThemedText themeColor="textSecondary">
        {date.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })}
        {days > 0 ? ` · in ${days} days` : ''}
      </ThemedText>

      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="headline">
          {showResults ? 'Mock ballot results' : 'Cast a mock ballot'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {showResults
            ? `n = ${election.total} Demanity members. Members choose to be here, so this is not a scientific poll.`
            : 'One private ballot per verified member. Demanity records only that you voted, never who you picked. Results appear after you vote.'}
        </ThemedText>
        {election.candidates.map((c) => {
          const selected = choice === c.id;
          const pct =
            showResults && election.total ? Math.round(((c.votes ?? 0) / election.total) * 100) : 0;
          return (
            <Pressable
              key={c.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: showResults }}
              accessibilityLabel={`${c.name}, ${c.party}`}
              disabled={showResults}
              onPress={() => setChoice(c.id)}
              style={[
                styles.candidate,
                {
                  borderColor: selected ? Brand.primary : theme.backgroundSelected,
                  backgroundColor: theme.background,
                },
              ]}
            >
              {showResults ? (
                <View
                  style={[
                    styles.fill,
                    { width: `${pct}%`, backgroundColor: theme.backgroundSelected },
                  ]}
                />
              ) : null}
              <Avatar name={c.name} size={36} />
              <View style={styles.flex}>
                <ThemedText type="smallBold">{c.name}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {c.party}
                  {c.actualPct !== null ? ` · official result ${c.actualPct}%` : ''}
                </ThemedText>
              </View>
              {showResults ? (
                <ThemedText type="headline">{pct}%</ThemedText>
              ) : (
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={selected ? Brand.primary : theme.textSecondary}
                />
              )}
            </Pressable>
          );
        })}
        {!showResults ? (
          <>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: attested }}
              onPress={() => setAttested((a) => !a)}
              style={styles.attest}
            >
              <Ionicons
                name={attested ? 'checkbox' : 'square-outline'}
                size={22}
                color={attested ? Brand.primary : theme.textSecondary}
              />
              <ThemedText type="small" style={styles.flex}>
                I vote in this election (I live in {election.place.name}).
              </ThemedText>
            </Pressable>
            <ErrorText message={error} />
            <Button
              title={member ? 'Cast mock ballot' : 'Join to cast a mock ballot'}
              onPress={cast}
              busy={busy}
            />
          </>
        ) : null}
        {election.meanAbsoluteErrorPoints !== null ? (
          <ThemedText type="small">
            How close we were: the mock results were off by {election.meanAbsoluteErrorPoints}{' '}
            percentage points per candidate on average.
          </ThemedText>
        ) : null}
      </View>

      <Section title="Before election day">
        <View style={styles.links}>
          <LinkRow
            icon="checkbox-outline"
            label="Register to vote or check your registration"
            onPress={() =>
              router.push({ pathname: '/guide/[slug]', params: { slug: 'register-to-vote' } })
            }
          />
          <LinkRow
            icon="open-outline"
            label="Vote.gov (official registration site)"
            onPress={() => Linking.openURL('https://vote.gov/')}
          />
          <LinkRow
            icon="people-outline"
            label="Find and contact your elected officials"
            onPress={() =>
              router.push({ pathname: '/guide/[slug]', params: { slug: 'contact-your-officials' } })
            }
          />
        </View>
      </Section>

      <ThemedText type="caption" themeColor="textSecondary">
        Why mock ballots? They come from verified, one-person-one-account members, which removes
        bots and duplicates. That doesn’t make them representative: after each election Demanity
        will publish how close the mock results were to the official count, so you can judge their
        accuracy yourself. Today, residency is self-declared; it will be checked privately once
        verified-state credentials ship.
      </ThemedText>
    </Screen>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
}: {
  icon: 'checkbox-outline' | 'open-outline' | 'people-outline';
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [
        styles.link,
        { backgroundColor: theme.backgroundElement },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Ionicons name={icon} size={18} color={Brand.primary} />
      <ThemedText type="smallBold" style={styles.flex}>
        {label}
      </ThemedText>
      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  card: { borderRadius: Radius.large, padding: Spacing.three, gap: Spacing.three - 4 },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    borderWidth: 2,
    borderRadius: Radius.medium,
    padding: Spacing.three - 4,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  attest: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  links: { gap: Spacing.two },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    padding: Spacing.three - 4,
    borderRadius: Radius.medium,
  },
});
