import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BillCard } from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { community, describeError, type Bill, type Poll, type Repost } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

/** A post's poll: one private vote each; results after you vote or it closes. */
export function PollCard({ postId }: { postId: string }) {
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    community
      .poll(token, postId)
      .then(setPoll)
      .catch(() => setPoll(null));
  useEffect(() => {
    community
      .poll(token, postId)
      .then(setPoll)
      .catch(() => setPoll(null));
  }, [token, postId]);
  if (!poll) return null;
  const show = poll.total !== null;
  return (
    <View style={[styles.poll, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.row}>
        <Ionicons name="stats-chart" size={16} color={Brand.primary} />
        <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
          POLL{' '}
          {poll.closed
            ? '· CLOSED'
            : `· CLOSES ${new Date(poll.closesAt).toLocaleDateString('en-US')}`}
        </ThemedText>
      </View>
      <ThemedText type="headline">{poll.question}</ThemedText>
      {poll.options.map((o) => {
        const pct = show && poll.total ? Math.round(((o.votes ?? 0) / poll.total) * 100) : 0;
        const selected = choice === o.id;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: show }}
            disabled={show}
            onPress={() => setChoice(o.id)}
            style={[
              styles.option,
              {
                borderColor: selected ? Brand.primary : theme.backgroundSelected,
                backgroundColor: theme.background,
              },
            ]}
          >
            {show ? (
              <View
                style={[
                  styles.fill,
                  { width: `${pct}%`, backgroundColor: theme.backgroundSelected },
                ]}
              />
            ) : null}
            <ThemedText type="small" style={styles.flex}>
              {o.label}
            </ThemedText>
            {show ? <ThemedText type="smallBold">{pct}%</ThemedText> : null}
          </Pressable>
        );
      })}
      {show ? (
        <ThemedText type="caption" themeColor="textSecondary">
          n = {poll.total}. {poll.label}
        </ThemedText>
      ) : (
        <>
          <ErrorText message={error} />
          <Button
            title={isFullyOnboarded(me) ? 'Vote' : 'Join to vote'}
            size="small"
            onPress={async () => {
              if (!isFullyOnboarded(me) || !token) return router.push('/join');
              if (!choice) return setError('Pick an option first.');
              try {
                await community.votePoll(token, poll.id, choice);
                await load();
              } catch (err) {
                setError(describeError(err));
              }
            }}
          />
          <ThemedText type="caption" themeColor="textSecondary">
            Private: Demanity records that you voted, not your choice. Results appear after you
            vote.
          </ThemedText>
        </>
      )}
    </View>
  );
}

/**
 * Repost button. It only appears on an item's own page, after you've opened
 * it: our "read before you repost" nudge, built in.
 */
export function RepostButton({
  targetType,
  targetId,
}: {
  targetType: 'post' | 'bill' | 'leader';
  targetId: string;
}) {
  const router = useRouter();
  const { token, me } = useAuth();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done)
    return (
      <ThemedText type="caption" style={{ color: Brand.like, fontWeight: 800 }}>
        Reposted to your followers.
      </ThemedText>
    );
  if (!open)
    return (
      <Button
        title="Repost"
        size="small"
        variant="secondary"
        onPress={() => (isFullyOnboarded(me) ? setOpen(true) : router.push('/join'))}
      />
    );
  return (
    <View style={styles.form}>
      <Field
        label="Add a comment (optional)"
        value={comment}
        onChangeText={setComment}
        maxLength={500}
      />
      <ErrorText message={error} />
      <Button
        title="Repost"
        size="small"
        onPress={async () => {
          try {
            await community.repost(token!, targetType, targetId, comment.trim());
            setDone(true);
          } catch (err) {
            setError(describeError(err));
          }
        }}
      />
    </View>
  );
}

/** A repost in the feed: who reposted it, their comment, and the item. */
export function RepostCard({ repost }: { repost: Repost }) {
  const router = useRouter();
  const theme = useTheme();
  const t = repost.target as Record<string, string>;
  const open = () =>
    repost.targetType === 'post'
      ? router.push({ pathname: '/post/[id]', params: { id: t.id! } })
      : repost.targetType === 'leader'
        ? router.push({ pathname: '/leader/[slug]', params: { slug: t.slug! } })
        : undefined;
  return (
    <View style={[styles.repost, { borderBottomColor: theme.backgroundSelected }]}>
      <View style={styles.row}>
        <Ionicons name="repeat" size={15} color={theme.textSecondary} />
        <ThemedText type="caption" themeColor="textSecondary">
          {repost.reason}
        </ThemedText>
      </View>
      {repost.comment ? <ThemedText>{repost.comment}</ThemedText> : null}
      {repost.targetType === 'bill' ? (
        <BillCard bill={repost.target as unknown as Bill} />
      ) : (
        <Pressable
          accessibilityRole="link"
          onPress={open}
          style={[styles.quoted, { borderColor: theme.backgroundSelected }]}
        >
          <ThemedText type="smallBold">{t.title ?? t.name}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {repost.targetType === 'post'
              ? t.communityName
              : `${t.office}${t.party ? ` · ${t.party}` : ''}`}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  poll: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Radius.medium,
    padding: Spacing.three - 4,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  form: { gap: Spacing.two },
  repost: { padding: Spacing.three, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  quoted: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three - 4, gap: 2 },
});
