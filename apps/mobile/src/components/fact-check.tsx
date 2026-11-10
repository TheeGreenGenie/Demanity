import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chips, Section } from '@/components/civic';
import { Button, ErrorText } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  describeError,
  factChecks,
  type Comment,
  type CommentFactCheck,
  type FactCheckLabel,
  type FactCheckSeat,
} from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

const TONE: Record<FactCheckLabel, string> = {
  verified: Brand.like,
  context_added: Brand.primary,
  misleading: '#C2410C',
  removed: Brand.dislike,
};

const LABEL_TEXT: Record<FactCheckLabel, string> = {
  verified: 'Verified',
  context_added: 'Context added',
  misleading: 'Misleading',
  removed: 'Remove (clear misinformation only)',
};

/** Loads fact-check labels for every comment on a post. */
export function useFactChecks(postId: string | undefined) {
  const [labels, setLabels] = useState<Record<string, CommentFactCheck>>({});
  const load = useCallback(() => {
    if (!postId) return;
    factChecks
      .labels(postId)
      .then((r) => setLabels(r.labels))
      .catch(() => setLabels({}));
  }, [postId]);
  useEffect(load, [load]);
  return { labels, reload: load };
}

/**
 * A comment's fact-check label, plus the actions a reader can take:
 * flag someone else's comment, request a check of your own, or ask for a
 * reversal of a decision.
 */
export function CommentFactCheckRow({
  comment,
  check,
  onDone,
}: {
  comment: Comment;
  check: CommentFactCheck | undefined;
  onDone: () => void;
}) {
  const router = useRouter();
  const { token, me } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const member = isFullyOnboarded(me) && token !== null;
  const mine = comment.author?.username === me?.username;

  const act = async (fn: () => Promise<{ status: string }>, done: string) => {
    if (!member) return router.push('/join');
    try {
      const r = await fn();
      setMsg(r.status === 'review_opened' ? 'Sent to a panel of three moderators.' : done);
      setError(null);
      onDone();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <View style={styles.row}>
      {check?.status === 'decided' && check.outcome ? (
        <View style={[styles.badge, { borderColor: TONE[check.outcome] }]}>
          <Ionicons name="shield-checkmark" size={13} color={TONE[check.outcome]} />
          <ThemedText type="caption" style={{ color: TONE[check.outcome], fontWeight: 800 }}>
            {check.label} · {check.panel}
            {check.reversed ? ' · on second review' : ''}
          </ThemedText>
        </View>
      ) : check?.status === 'in_review' ? (
        <ThemedText type="caption" themeColor="textSecondary">
          Fact-check in progress
        </ThemedText>
      ) : null}
      {msg ? (
        <ThemedText type="caption" style={{ color: Brand.like, fontWeight: 800 }}>
          {msg}
        </ThemedText>
      ) : comment.status !== 'visible' && !(check?.status === 'decided' && mine) ? null : !check ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            mine
              ? act(() => factChecks.request(token!, comment.id), 'Requested.')
              : act(
                  () => factChecks.flag(token!, comment.id),
                  'Flagged. Enough flags send it to a panel.',
                )
          }
        >
          <ThemedText type="caption" themeColor="textSecondary" style={styles.link}>
            {mine ? 'Request a fact-check' : 'Flag for fact-check'}
          </ThemedText>
        </Pressable>
      ) : check.status === 'decided' && check.id && (mine || me?.moderator) && !check.reversed ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => act(() => factChecks.reversal(token!, check.id!), 'Requested.')}
        >
          <ThemedText type="caption" themeColor="textSecondary" style={styles.link}>
            Ask a different panel to review
          </ThemedText>
        </Pressable>
      ) : null}
      <ErrorText message={error} />
    </View>
  );
}

/** Moderator panel seats: blind votes, with the AI draft as a starting point only. */
export function FactCheckQueue() {
  const theme = useTheme();
  const { token } = useAuth();
  const [seats, setSeats] = useState<FactCheckSeat[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [lean, setLean] = useState<'left' | 'center' | 'right' | ''>('');
  const [picked, setPicked] = useState<Record<string, FactCheckLabel>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    factChecks
      .queue(token)
      .then((r) => {
        setSeats(r.assigned);
        setWaiting(r.awaitingPanel);
      })
      .catch((err) => setError(describeError(err)));
  }, [token]);
  useEffect(load, [load]);

  return (
    <>
      <Section
        title={`Fact-check panels (${seats.length})`}
        caption={`You vote blind; others’ votes stay hidden until all three are in. ${waiting} waiting for enough moderators.`}
      />
      <ThemedText type="caption" themeColor="textSecondary">
        Your lean is used only to mix panels and is published only as a total.
      </ThemedText>
      <Chips
        label="Your political lean"
        value={lean}
        onChange={async (l) => {
          if (!l) return;
          setLean(l);
          try {
            await factChecks.setLean(token!, l);
          } catch (err) {
            setError(describeError(err));
          }
        }}
        options={[
          { key: 'left', label: 'Left' },
          { key: 'center', label: 'Center' },
          { key: 'right', label: 'Right' },
        ]}
      />
      <ErrorText message={error} />
      {seats.map((s) => (
        <View key={s.id} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
            {s.trigger === 'reversal'
              ? `SECOND REVIEW · first panel said ${s.previousOutcome?.replace('_', ' ')}`
              : s.trigger === 'author_request'
                ? 'AUTHOR ASKED FOR A CHECK'
                : 'FLAGGED BY MEMBERS'}{' '}
            · {s.votesIn}/3 voted
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            On “{s.postTitle}”
          </ThemedText>
          <ThemedText>{s.comment}</ThemedText>
          {s.aiDraft ? (
            <View style={[styles.draft, { borderLeftColor: theme.backgroundSelected }]}>
              <ThemedText type="caption" themeColor="textSecondary" style={{ fontWeight: 800 }}>
                AI DRAFT ({s.aiModel}): a starting point, not a verdict
                {s.aiDraft.injectionAttemptDetected
                  ? ' · the comment tried to instruct the AI'
                  : ''}
              </ThemedText>
              <ThemedText type="small">{s.aiDraft.summary}</ThemedText>
              {s.aiDraft.claims.map((c, i) => (
                <ThemedText key={i} type="caption">
                  • {c.claim}:{' '}
                  <ThemedText type="caption" style={{ fontWeight: 800 }}>
                    {c.assessment.replace('_', ' ')}
                  </ThemedText>
                  . {c.reasoning}
                </ThemedText>
              ))}
              {s.aiDraft.whereToCheck.map((w, i) => (
                <ThemedText key={`w${i}`} type="caption" themeColor="textSecondary">
                  Check {w.domain}: {w.what}
                </ThemedText>
              ))}
            </View>
          ) : (
            <ThemedText type="caption" themeColor="textSecondary">
              {s.aiStatus === 'pending'
                ? 'AI draft in progress.'
                : s.aiStatus === 'failed'
                  ? 'AI draft unavailable; review the comment directly.'
                  : 'No AI step configured; review the comment directly.'}
            </ThemedText>
          )}
          {s.myVote ? (
            <ThemedText type="caption" style={{ color: Brand.like, fontWeight: 800 }}>
              You voted: {LABEL_TEXT[s.myVote]}
            </ThemedText>
          ) : (
            <>
              <View style={styles.wrap}>
                {(Object.keys(LABEL_TEXT) as FactCheckLabel[]).map((l) => (
                  <Pressable
                    key={l}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: picked[s.id] === l }}
                    onPress={() => setPicked((p) => ({ ...p, [s.id]: l }))}
                    style={[
                      styles.choice,
                      {
                        borderColor: picked[s.id] === l ? TONE[l] : theme.backgroundSelected,
                        backgroundColor: theme.background,
                      },
                    ]}
                  >
                    <ThemedText type="caption" style={{ fontWeight: 800 }}>
                      {LABEL_TEXT[l]}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <Button
                title="Cast blind vote"
                size="small"
                onPress={async () => {
                  const v = picked[s.id];
                  if (!v) return setError('Pick a label first.');
                  try {
                    await factChecks.vote(token!, s.id, v);
                    load();
                  } catch (err) {
                    setError(describeError(err));
                  }
                }}
              />
            </>
          )}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  link: { textDecorationLine: 'underline' },
  card: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  draft: { borderLeftWidth: 3, paddingLeft: Spacing.two, gap: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  choice: {
    borderWidth: 2,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 2,
  },
});
