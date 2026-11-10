import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, ErrorText, Field } from '@/components/form';
import { ActionPill, CommunityIcon, ThreadedComments, VotePill } from '@/components/forum';
import { Screen } from '@/components/screen';
import { timeAgo } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeError, social, type Comment, type Post } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

/** A post and its discussion, in the forum style: full post, then threaded comments. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([social.post(token, id), social.comments(token, id)]);
      setPost(p);
      setComments(c.comments);
    } catch (err) {
      setError(describeError(err));
    }
  }, [token, id]);

  // Initial load: state is set only from the promise callbacks.
  useEffect(() => {
    let cancelled = false;
    Promise.all([social.post(token, id), social.comments(token, id)])
      .then(([p, c]) => {
        if (cancelled) return;
        setPost(p);
        setComments(c.comments);
      })
      .catch((err) => !cancelled && setError(describeError(err)));
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  async function send() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await social.createComment(token!, id, draft.trim(), replyTo?.id);
      setDraft('');
      setReplyTo(null);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!post) {
    return (
      <Screen>
        <ErrorText message={error} />
      </Screen>
    );
  }
  const removed = post.status === 'removed';
  const member = isFullyOnboarded(me);

  return (
    <Screen flush>
      <View style={[styles.post, { borderBottomColor: theme.backgroundSelected }]}>
        <Pressable
          accessibilityRole="link"
          onPress={() =>
            router.push({ pathname: '/c/[slug]', params: { slug: post.community.slug } })
          }
          style={styles.meta}
        >
          <CommunityIcon kind={post.community.kind} size={32} />
          <View>
            <ThemedText type="smallBold">{post.community.name}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {post.author ? `u/${post.author.username}` : 'deleted'} · {timeAgo(post.createdAt)}
            </ThemedText>
          </View>
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>
          {post.title}
        </ThemedText>
        {removed ? (
          <ThemedText themeColor="textSecondary">
            Removed by moderators ({post.removedReason?.replace(/_/g, ' ')}). See the public
            moderation log for details.
          </ThemedText>
        ) : (
          <>
            <ThemedText style={styles.body}>{post.body}</ThemedText>
            <View style={styles.actions}>
              <VotePill
                kind={post.community.kind}
                targetType="post"
                targetId={post.id}
                counts={post.counts}
                mine={post.myReaction}
              />
              <ActionPill
                icon="chatbubble-outline"
                label={String(comments.length)}
                accessibilityLabel={`Comments (${comments.length})`}
              />
              {post.author ? (
                <ActionPill
                  icon="person-outline"
                  label="Profile"
                  onPress={() =>
                    router.push({
                      pathname: '/u/[username]',
                      params: { username: post.author!.username },
                    })
                  }
                />
              ) : null}
            </View>
          </>
        )}
      </View>

      {!removed && member ? (
        <View style={[styles.composer, { borderBottomColor: theme.backgroundSelected }]}>
          <View style={styles.meta}>
            <Avatar name={me!.username} size={28} />
            {replyTo ? (
              <Pressable accessibilityRole="button" onPress={() => setReplyTo(null)}>
                <ThemedText type="caption" themeColor="textSecondary">
                  Replying to {replyTo.author?.username ?? 'deleted'} · tap to cancel
                </ThemedText>
              </Pressable>
            ) : (
              <ThemedText type="caption" themeColor="textSecondary">
                Join the conversation
              </ThemedText>
            )}
          </View>
          <Field
            label={replyTo ? 'Your reply' : 'Add a comment'}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={10000}
          />
          <Button title="Post comment" onPress={send} busy={busy} size="small" />
        </View>
      ) : !removed ? (
        <View style={styles.composer}>
          <Button
            title="Join to comment"
            variant="secondary"
            onPress={() => router.push('/join')}
          />
        </View>
      ) : null}
      <ErrorText message={error} />

      <View style={styles.commentsHead}>
        <ThemedText type="headline">
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </ThemedText>
      </View>
      <ThreadedComments
        comments={comments}
        kind={post.community.kind}
        onReply={member && !removed ? setReplyTo : undefined}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  post: {
    padding: Spacing.three,
    gap: Spacing.three - 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { fontSize: 24, lineHeight: 30 },
  body: { fontSize: 17, lineHeight: 25 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  composer: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  commentsHead: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
