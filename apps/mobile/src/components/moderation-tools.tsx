import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Chips } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError, moderation, type ContextNote, type NoteTarget } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Published reason codes (apps/api/src/moderation/reasons.ts). */
export const REMOVAL_REASONS = [
  { key: 'clear_misinformation', label: 'Clear misinformation' },
  { key: 'hate_speech', label: 'Hate speech' },
  { key: 'harassment', label: 'Harassment' },
  { key: 'spam', label: 'Spam' },
  { key: 'doxxing', label: 'Doxxing' },
  { key: 'other_policy_violation', label: 'Other violation' },
] as const;
const NOTE_REASONS = [
  { key: 'missing_context', label: 'Missing context' },
  { key: 'misleading_claim', label: 'Misleading' },
  { key: 'outdated_information', label: 'Outdated' },
] as const;

/** Context notes on a piece of content: labeled, sourced, moderator never named. */
export function ContextNotes({
  targetType,
  targetId,
  version = 0,
}: {
  targetType: NoteTarget;
  targetId: string;
  version?: number;
}) {
  const theme = useTheme();
  const [notes, setNotes] = useState<ContextNote[]>([]);
  useEffect(() => {
    let cancelled = false;
    moderation
      .notes(targetType, targetId)
      .then((r) => !cancelled && setNotes(r.notes))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId, version]);
  if (notes.length === 0) return null;
  return (
    <View style={styles.notes}>
      {notes.map((n) => (
        <View
          key={n.id}
          style={[
            styles.note,
            { backgroundColor: theme.backgroundElement, borderLeftColor: Brand.kudos },
          ]}
        >
          <View style={styles.noteHead}>
            <Ionicons name="information-circle" size={16} color={Brand.kudos} />
            <ThemedText type="caption" style={{ color: Brand.kudos, fontWeight: 900 }}>
              CONTEXT ADDED BY MODERATORS
            </ThemedText>
          </View>
          <ThemedText type="small">{n.body}</ThemedText>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(n.sourceUrl)}>
            <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 800 }}>
              Source: {n.sourceName} ↗
            </ThemedText>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/**
 * Moderator actions on one item: add a sourced context note (preferred), or
 * remove it for a clear policy violation. Shown only to moderators; the
 * server checks permissions and refuses decisions on your own content.
 */
export function ModeratorPanel({
  targetType,
  targetId,
  canRemove,
  onDone,
}: {
  targetType: NoteTarget;
  targetId: string;
  canRemove: boolean;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { token, me } = useAuth();
  const [mode, setMode] = useState<'closed' | 'note' | 'remove'>('closed');
  const [noteBody, setNoteBody] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [noteReason, setNoteReason] = useState<string>('missing_context');
  const [removeReason, setRemoveReason] = useState<string>('clear_misinformation');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me?.moderator || !token) return null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode('closed');
      setNoteBody('');
      setSourceUrl('');
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.panel, { borderColor: theme.backgroundSelected }]}>
      <View style={styles.row}>
        <Ionicons name="shield-checkmark" size={16} color={Brand.primary} />
        <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
          MODERATOR
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => setMode(mode === 'note' ? 'closed' : 'note')}
        >
          <ThemedText type="caption" style={styles.link}>
            Add context note
          </ThemedText>
        </Pressable>
        {canRemove ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setMode(mode === 'remove' ? 'closed' : 'remove')}
          >
            <ThemedText type="caption" style={[styles.link, { color: Brand.danger }]}>
              Remove
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {mode === 'note' ? (
        <View style={styles.form}>
          <Field
            label="Context"
            value={noteBody}
            onChangeText={setNoteBody}
            multiline
            maxLength={1000}
          />
          <Field
            label="Source link (approved sources only)"
            value={sourceUrl}
            onChangeText={setSourceUrl}
            autoCapitalize="none"
          />
          <Chips
            label="Reason"
            value={noteReason}
            onChange={setNoteReason}
            options={NOTE_REASONS}
          />
          <Button
            title="Add note"
            size="small"
            busy={busy}
            onPress={() =>
              run(() =>
                moderation.addNote(token, {
                  targetType,
                  targetId,
                  body: noteBody.trim(),
                  sourceUrl: sourceUrl.trim(),
                  reasonCode: noteReason,
                }),
              )
            }
          />
        </View>
      ) : null}
      {mode === 'remove' ? (
        <View style={styles.form}>
          <ThemedText type="caption" themeColor="textSecondary">
            Remove only clear violations; otherwise add context. The removal is publicly logged and
            the author can appeal to a different moderator.
          </ThemedText>
          <Chips
            label="Reason"
            value={removeReason}
            onChange={setRemoveReason}
            options={REMOVAL_REASONS}
          />
          <Button
            title="Remove"
            size="small"
            variant="secondary"
            busy={busy}
            onPress={() =>
              run(() =>
                targetType === 'post'
                  ? moderation.removePost(token, targetId, removeReason)
                  : moderation.removeComment(token, targetId, removeReason),
              )
            }
          />
        </View>
      ) : null}
      <ErrorText message={error} />
    </View>
  );
}

/** The author of removed content (or content with a note) can appeal once. */
export function AppealBox({
  targetType,
  targetId,
}: {
  targetType: 'post' | 'comment' | 'context_note';
  targetId: string;
}) {
  const theme = useTheme();
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (sent)
    return (
      <ThemedText type="caption" themeColor="textSecondary">
        Appeal sent. A different moderator will review it; the outcome appears in the public log.
      </ThemedText>
    );
  if (!open)
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <ThemedText type="caption" style={styles.link}>
          Appeal this decision
        </ThemedText>
      </Pressable>
    );
  return (
    <View style={[styles.panel, { borderColor: theme.backgroundSelected }]}>
      <Field
        label="Why should this be reversed?"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={2000}
      />
      <ErrorText message={error} />
      <Button
        title="Send appeal"
        size="small"
        onPress={async () => {
          if (text.trim().length < 20) return setError('Explain in at least 20 characters.');
          try {
            await moderation.appeal(token!, targetType, targetId, text.trim());
            setSent(true);
          } catch (err) {
            setError(describeError(err));
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  notes: { gap: Spacing.two },
  note: { borderLeftWidth: 3, borderRadius: Radius.small, padding: Spacing.three - 4, gap: 4 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  panel: {
    borderWidth: 1,
    borderRadius: Radius.medium,
    padding: Spacing.three - 4,
    gap: Spacing.two,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  link: { color: Brand.primary, fontWeight: 800 },
  form: { gap: Spacing.two },
});
