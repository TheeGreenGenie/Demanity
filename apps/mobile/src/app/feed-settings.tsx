import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Chips, Section } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { community, describeError, social, type Community, type FeedPrefs } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Feed builder (R16): you decide what your feed shows. Mute communities or
 * people, choose whether bill updates and reposts appear, and sort by newest
 * or most upvoted today. Share your setup as a recipe code (muted people are
 * never included in a recipe).
 */
export default function FeedSettingsScreen() {
  const theme = useTheme();
  const { token } = useAuth();
  const [prefs, setPrefs] = useState<FeedPrefs | null>(null);
  const [all, setAll] = useState<Community[]>([]);
  const [muteUser, setMuteUser] = useState('');
  const [recipe, setRecipe] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    community
      .feedPrefs(token)
      .then(setPrefs)
      .catch((err) => setError(describeError(err)));
    social
      .communities(token)
      .then((r) => setAll(r.communities))
      .catch(() => undefined);
  }, [token]);

  async function save(next: Partial<FeedPrefs> & { recipe?: string }) {
    try {
      const r = await community.saveFeedPrefs(token!, next);
      setPrefs(r);
      setSaved(true);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  }
  if (!prefs) return <Screen>{error ? <ErrorText message={error} /> : null}</Screen>;
  const muted = new Set(prefs.mutedCommunities);

  return (
    <Screen
      title="Your feed"
      subtitle="You decide what shows up. Nothing is ranked behind your back."
    >
      {saved ? (
        <ThemedText type="caption" style={{ color: Brand.like, fontWeight: 800 }}>
          Saved.
        </ThemedText>
      ) : null}
      <ErrorText message={error} />

      <Section title="Order" />
      <Chips
        label="Order"
        value={prefs.sort}
        onChange={(sort) => save({ sort })}
        options={[
          { key: 'new', label: 'Newest first' },
          { key: 'top_day', label: 'Most upvoted today' },
        ]}
      />

      <Section title="Include" />
      {(
        [
          ['includeUpdates', 'Bill updates from leaders, places and bills you follow'],
          ['includeReposts', 'Reposts from people you follow'],
        ] as const
      ).map(([key, label]) => (
        <View key={key} style={styles.toggle}>
          <ThemedText type="small" style={styles.flex}>
            {label}
          </ThemedText>
          <Switch
            accessibilityLabel={label}
            value={prefs[key]}
            onValueChange={(v) => save({ [key]: v })}
            trackColor={{ true: Brand.primary, false: theme.backgroundSelected }}
          />
        </View>
      ))}

      <Section title="Muted communities" caption="Tap to mute or unmute." />
      <View style={styles.wrap}>
        {all
          .filter((c) => c.kind !== 'humanity')
          .map((c) => {
            const on = muted.has(c.slug);
            return (
              <Pressable
                key={c.slug}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() =>
                  save({
                    mutedCommunities: on
                      ? prefs.mutedCommunities.filter((s) => s !== c.slug)
                      : [...prefs.mutedCommunities, c.slug],
                  })
                }
                style={[
                  styles.chip,
                  { backgroundColor: on ? Brand.dislike : theme.backgroundElement },
                ]}
              >
                <ThemedText
                  type="caption"
                  style={{ fontWeight: 800, color: on ? '#fff' : theme.text }}
                >
                  {on ? '🔇 ' : ''}
                  {c.name}
                </ThemedText>
              </Pressable>
            );
          })}
      </View>

      <Section title="Muted people" />
      {prefs.mutedAccounts.map((u) => (
        <View key={u} style={styles.toggle}>
          <ThemedText type="small" style={styles.flex}>
            u/{u}
          </ThemedText>
          <Button
            title="Unmute"
            size="small"
            variant="ghost"
            onPress={() => save({ mutedAccounts: prefs.mutedAccounts.filter((x) => x !== u) })}
          />
        </View>
      ))}
      <Field
        label="Mute a username"
        value={muteUser}
        onChangeText={setMuteUser}
        autoCapitalize="none"
      />
      <Button
        title="Mute"
        size="small"
        variant="secondary"
        onPress={() => {
          const u = muteUser.trim().replace(/^u\//, '').toLowerCase();
          if (u) save({ mutedAccounts: [...new Set([...prefs.mutedAccounts, u])] });
          setMuteUser('');
        }}
      />

      <Section
        title="Recipe"
        caption="Share your setup, or use someone else's. Muted people are never shared."
      />
      <View style={[styles.recipe, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="caption" selectable numberOfLines={3}>
          {prefs.recipe}
        </ThemedText>
      </View>
      <Field
        label="Use a recipe code"
        value={recipe}
        onChangeText={setRecipe}
        autoCapitalize="none"
      />
      <Button
        title="Apply recipe"
        size="small"
        variant="secondary"
        onPress={() => recipe.trim() && save({ recipe: recipe.trim() })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.one + 2,
  },
  recipe: { borderRadius: Radius.small, padding: Spacing.three - 4 },
});
