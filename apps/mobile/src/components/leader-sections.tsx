import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Chips, Section } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { Empty } from '@/components/place-sections';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError, leaders, social, type Community, type Stance } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { parsePastDate } from '@/lib/validation';

export const POSITION: Record<Stance['position'], { label: string; color: string }> = {
  support: { label: 'Supports', color: Brand.like },
  oppose: { label: 'Opposes', color: Brand.dislike },
  mixed: { label: 'Mixed', color: Brand.kudos },
};

/** Official photo when there is one (with its credit), initials otherwise. */
export function LeaderPhoto({
  name,
  photoUrl,
  size,
}: {
  name: string | null;
  photoUrl: string | null | undefined;
  size: number;
}) {
  if (!photoUrl) return <Avatar name={name} size={size} />;
  return (
    <Image
      source={{ uri: photoUrl }}
      accessibilityLabel={name ? `Official photo of ${name}` : 'Official photo'}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}

/**
 * What the leader has said they stand for, by topic, newest first. Older
 * entries stay visible, so a change of position shows up as a timeline.
 */
export function StancesTab({ slug }: { slug: string }) {
  const theme = useTheme();
  const { me } = useAuth();
  const [stances, setStances] = useState<Stance[] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    leaders
      .stances(slug)
      .then((r) => setStances(r.stances))
      .catch(() => setStances([]));
  }, [slug, version]);
  if (!stances) return null;
  const byTopic = new Map<string, Stance[]>();
  for (const s of stances) byTopic.set(s.categoryName, [...(byTopic.get(s.categoryName) ?? []), s]);
  return (
    <View>
      <Section
        title="Stated positions"
        caption="What they've said, by topic, with sources. Changes stay on the record."
      />
      {stances.length === 0 ? <Empty text="No stated positions recorded yet." /> : null}
      {[...byTopic.entries()].map(([topic, list]) => (
        <View key={topic} style={[styles.topic, { borderBottomColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">{topic}</ThemedText>
          {list.map((s, i) => (
            <View key={s.id} style={[styles.entry, i > 0 && { opacity: 0.7 }]}>
              <View style={styles.entryHead}>
                <View style={[styles.chip, { borderColor: POSITION[s.position].color }]}>
                  <ThemedText
                    type="caption"
                    style={{ color: POSITION[s.position].color, fontWeight: 800 }}
                  >
                    {POSITION[s.position].label}
                  </ThemedText>
                </View>
                <ThemedText type="caption" themeColor="textSecondary">
                  {s.statedOn}
                  {i === 0 && list.length > 1 ? ' · latest' : ''}
                </ThemedText>
              </View>
              <ThemedText type="small">{s.statement}</ThemedText>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(s.sourceUrl)}>
                <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
                  Source: {s.sourceName} ↗
                </ThemedText>
              </Pressable>
            </View>
          ))}
        </View>
      ))}
      {me?.moderator ? <AddStance slug={slug} onAdded={() => setVersion((v) => v + 1)} /> : null}
    </View>
  );
}

function AddStance({ slug, onAdded }: { slug: string; onAdded: () => void }) {
  const theme = useTheme();
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState<Community[]>([]);
  const [category, setCategory] = useState('health');
  const [position, setPosition] = useState<Stance['position']>('support');
  const [statement, setStatement] = useState('');
  const [url, setUrl] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open)
      social
        .communities(null, 'topic')
        .then((r) => setTopics(r.communities))
        .catch(() => undefined);
  }, [open]);
  if (!open)
    return (
      <View style={styles.pad}>
        <Button
          title="Add a stated position (moderator)"
          variant="ghost"
          onPress={() => setOpen(true)}
        />
      </View>
    );
  async function save() {
    const statedOn = parsePastDate(date);
    if (!statedOn) return setError('Use MM/DD/YYYY, not in the future.');
    try {
      await leaders.addStance(token!, slug, {
        category,
        position,
        statement: statement.trim(),
        sourceUrl: url.trim(),
        statedOn,
      });
      setOpen(false);
      setStatement('');
      setUrl('');
      setDate('');
      onAdded();
    } catch (err) {
      setError(describeError(err));
    }
  }
  return (
    <View style={[styles.form, { backgroundColor: theme.backgroundElement }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Chips
          label="Topic"
          value={category}
          onChange={setCategory}
          options={topics.map((t) => ({ key: t.slug, label: t.name }))}
        />
      </ScrollView>
      <Chips
        label="Position"
        value={position}
        onChange={setPosition}
        options={[
          { key: 'support', label: 'Supports' },
          { key: 'oppose', label: 'Opposes' },
          { key: 'mixed', label: 'Mixed' },
        ]}
      />
      <Field
        label="What did they say?"
        value={statement}
        onChangeText={setStatement}
        multiline
        maxLength={1000}
      />
      <Field
        label="Source link (approved sources only)"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
      />
      <Field label="When (MM/DD/YYYY)" value={date} onChangeText={setDate} />
      <ErrorText message={error} />
      <Button title="Save position" onPress={save} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing.three },
  topic: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entry: { gap: 4 },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.two },
  form: {
    margin: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    gap: Spacing.two,
  },
});
