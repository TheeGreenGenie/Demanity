import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { CommentThread, ReactionBar, timeAgo } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { describeError, social, type Comment, type Post } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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

  return (
    <Screen>
      <Pressable
        accessibilityRole="link"
        onPress={() =>
          router.push({ pathname: '/c/[slug]', params: { slug: post.community.slug } })
        }
      >
        <ThemedText type="small" themeColor="textSecondary">
          {post.community.name}
        </ThemedText>
      </Pressable>
      <ThemedText type="subtitle">{post.title}</ThemedText>
      <View style={styles.meta}>
        {post.author ? (
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              router.push({
                pathname: '/u/[username]',
                params: { username: post.author!.username },
              })
            }
          >
            <ThemedText type="small">@{post.author.username}</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="small">deleted account</ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          · {timeAgo(post.createdAt)}
        </ThemedText>
      </View>
      {removed ? (
        <ThemedText themeColor="textSecondary">
          Removed by moderators ({post.removedReason?.replace(/_/g, ' ')}). See the public
          moderation log for details.
        </ThemedText>
      ) : (
        <>
          <ThemedText>{post.body}</ThemedText>
          <ReactionBar
            kind={post.community.kind}
            targetType="post"
            targetId={post.id}
            counts={post.counts}
            mine={post.myReaction}
          />
        </>
      )}

      <ThemedText type="smallBold">
        {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
      </ThemedText>
      <CommentThread
        comments={comments}
        kind={post.community.kind}
        onReply={isFullyOnboarded(me) && !removed ? setReplyTo : undefined}
      />

      {!removed && isFullyOnboarded(me) ? (
        <View style={styles.composer}>
          {replyTo ? (
            <Pressable accessibilityRole="button" onPress={() => setReplyTo(null)}>
              <ThemedText type="small" themeColor="textSecondary">
                Replying to @{replyTo.author?.username ?? 'deleted'} · tap to cancel
              </ThemedText>
            </Pressable>
          ) : null}
          <Field
            label={replyTo ? 'Your reply' : 'Add a comment'}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={10000}
          />
          <Button
            title="Post comment"
            onPress={send}
            busy={busy}
            disabled={draft.trim().length === 0}
          />
        </View>
      ) : !removed ? (
        <Button title="Join to comment" variant="secondary" onPress={() => router.push('/join')} />
      ) : null}
      <ErrorText message={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', gap: Spacing.one, alignItems: 'center' },
  composer: { gap: Spacing.two },
});
