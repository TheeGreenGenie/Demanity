import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { social, type Comment, type CommunityKind, type Post, type ReactionKind } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86_400 * 30) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const REACTION_LABEL: Record<ReactionKind, string> = {
  like: 'Like',
  dislike: 'Dislike',
  kudos: 'Kudos',
};
const REACTION_COLOR: Record<ReactionKind, string> = {
  like: Brand.like,
  dislike: Brand.dislike,
  kudos: Brand.kudos,
};

/**
 * Reaction buttons. Humanity offers only kudos (no dislikes, R18); everywhere
 * else offers like/dislike. Guests see counts but are prompted to join.
 */
export function ReactionBar({
  kind,
  targetType,
  targetId,
  counts,
  mine,
}: {
  kind: CommunityKind;
  targetType: 'post' | 'comment';
  targetId: string;
  counts: { like: number; dislike: number; kudos: number };
  mine: ReactionKind | null;
}) {
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const [state, setState] = useState({ counts, mine });
  const options: ReactionKind[] = kind === 'humanity' ? ['kudos'] : ['like', 'dislike'];

  async function toggle(r: ReactionKind) {
    if (!isFullyOnboarded(me) || !token) {
      router.push('/join');
      return;
    }
    const previous = state;
    const next = { counts: { ...state.counts }, mine: state.mine === r ? null : r };
    if (state.mine) next.counts[state.mine] -= 1;
    if (next.mine) next.counts[next.mine] += 1;
    setState(next); // optimistic
    try {
      if (next.mine) await social.react(token, targetType, targetId, next.mine);
      else await social.unreact(token, targetType, targetId);
    } catch {
      setState(previous);
    }
  }

  return (
    <View style={styles.row}>
      {options.map((r) => {
        const active = state.mine === r;
        return (
          <Pressable
            key={r}
            accessibilityRole="button"
            accessibilityLabel={`${REACTION_LABEL[r]} (${state.counts[r]})`}
            accessibilityState={{ selected: active }}
            onPress={() => toggle(r)}
            style={[
              styles.chip,
              { borderColor: active ? REACTION_COLOR[r] : theme.backgroundSelected },
              active && { backgroundColor: REACTION_COLOR[r] },
            ]}
          >
            <ThemedText type="small" style={active ? { color: Brand.onPrimary } : undefined}>
              {REACTION_LABEL[r]} · {state.counts[r]}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PostCard({ post, showCommunity = true }: { post: Post; showCommunity?: boolean }) {
  const router = useRouter();
  const removed = post.status === 'removed';
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {post.reason ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          accessibilityLabel={`Why you’re seeing this: ${post.reason}`}
        >
          {post.reason}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
        style={styles.cardBody}
      >
        <ThemedText type="small" themeColor="textSecondary">
          {showCommunity ? `${post.community.name} · ` : ''}
          {post.author ? `@${post.author.username}` : 'deleted account'} · {timeAgo(post.createdAt)}
        </ThemedText>
        <ThemedText type="smallBold" style={styles.title}>
          {post.title}
        </ThemedText>
        {removed ? (
          <ThemedText type="small" themeColor="textSecondary">
            Removed by moderators ({post.removedReason?.replace(/_/g, ' ')}).
          </ThemedText>
        ) : post.body ? (
          <ThemedText numberOfLines={4}>{post.body}</ThemedText>
        ) : null}
      </Pressable>
      {!removed ? (
        <View style={styles.footer}>
          <ReactionBar
            kind={post.community.kind}
            targetType="post"
            targetId={post.id}
            counts={post.counts}
            mine={post.myReaction}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {post.counts.comments} {post.counts.comments === 1 ? 'comment' : 'comments'}
          </ThemedText>
        </View>
      ) : null}
    </ThemedView>
  );
}

export function FollowButton({
  kind,
  name,
  following,
  onChange,
}: {
  kind: 'community' | 'user';
  name: string;
  following: boolean;
  onChange?: (following: boolean) => void;
}) {
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const [on, setOn] = useState(following);

  async function press() {
    if (!isFullyOnboarded(me) || !token) {
      router.push('/join');
      return;
    }
    const next = !on;
    setOn(next);
    try {
      if (next) await social.follow(token, kind, name);
      else await social.unfollow(token, kind, name);
      onChange?.(next);
    } catch {
      setOn(!next);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={press}
      style={[
        styles.follow,
        on ? { backgroundColor: theme.backgroundSelected } : { backgroundColor: Brand.primary },
      ]}
    >
      <ThemedText type="smallBold" style={on ? undefined : { color: Brand.onPrimary }}>
        {on ? 'Following' : 'Follow'}
      </ThemedText>
    </Pressable>
  );
}

/** Comments arranged as a thread: replies indent under their parent. */
export function CommentThread({
  comments,
  kind,
  onReply,
}: {
  comments: Comment[];
  kind: CommunityKind;
  onReply?: (c: Comment) => void;
}) {
  const theme = useTheme();
  const children = new Map<string | null, Comment[]>();
  for (const c of comments) {
    const list = children.get(c.parentId) ?? [];
    list.push(c);
    children.set(c.parentId, list);
  }

  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((c) => (
      <View
        key={c.id}
        style={[
          styles.comment,
          depth > 0 && {
            marginLeft: Math.min(depth, 4) * Spacing.three,
            borderLeftColor: theme.backgroundSelected,
            borderLeftWidth: 2,
            paddingLeft: Spacing.two,
          },
        ]}
      >
        <ThemedText type="small" themeColor="textSecondary">
          {c.author ? `@${c.author.username}` : 'deleted account'} · {timeAgo(c.createdAt)}
        </ThemedText>
        <ThemedText>{c.body ?? '[removed]'}</ThemedText>
        {c.body !== null ? (
          <View style={styles.footer}>
            <ReactionBar
              kind={kind}
              targetType="comment"
              targetId={c.id}
              counts={{ like: c.likes, dislike: c.dislikes, kudos: c.kudos }}
              mine={c.myReaction}
            />
            {onReply ? (
              <Pressable accessibilityRole="button" onPress={() => onReply(c)}>
                <ThemedText type="small" themeColor="textSecondary">
                  Reply
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {render(c.id, depth + 1)}
      </View>
    ));

  return <View style={styles.thread}>{render(null, 0)}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  card: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  cardBody: { gap: Spacing.one },
  title: { fontSize: 18, lineHeight: 24 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  follow: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignSelf: 'flex-start',
  },
  thread: { gap: Spacing.three },
  comment: { gap: Spacing.one },
});
