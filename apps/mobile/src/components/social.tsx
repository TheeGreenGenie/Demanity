import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { social, type Comment, type CommunityKind, type Post, type ReactionKind } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 86_400 * 7) return `${Math.floor(s / 86_400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n);

const REACTIONS: Record<
  ReactionKind,
  { label: string; icon: IconName; active: IconName; color: string }
> = {
  like: { label: 'Like', icon: 'thumbs-up-outline', active: 'thumbs-up', color: Brand.like },
  dislike: {
    label: 'Dislike',
    icon: 'thumbs-down-outline',
    active: 'thumbs-down',
    color: Brand.dislike,
  },
  kudos: { label: 'Kudos', icon: 'sparkles-outline', active: 'sparkles', color: Brand.kudos },
};

export const communityColor = (kind: CommunityKind) =>
  kind === 'humanity' ? Brand.humanity : kind === 'location' ? Brand.location : Brand.topic;

/** An icon + count action, like the action row under posts in big social apps. */
function Action({
  icon,
  color,
  count,
  label,
  selected,
  onPress,
}: {
  icon: IconName;
  color: string;
  count: number;
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const tint = selected ? color : theme.textSecondary;
  const content = (
    <>
      <Ionicons name={icon} size={19} color={tint} />
      <ThemedText type="caption" style={{ color: tint }}>
        {count > 0 ? compact(count) : ''}
      </ThemedText>
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.action} accessibilityLabel={`${label} (${count})`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} (${count})`}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
    >
      {content}
    </Pressable>
  );
}

export const REACTION_DEFS = REACTIONS;

/**
 * Shared reaction state: optimistic toggling, guests sent to Join, and the
 * Humanity rule (kudos only, no dislikes, R18). Used by every reaction UI.
 */
export function useReaction({
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

  return { state, options, toggle };
}

/**
 * Reaction buttons. Humanity offers only kudos (no dislikes, R18); everywhere
 * else offers like/dislike. Guests see counts and are sent to Join on tap.
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
  const { state, options, toggle } = useReaction({ kind, targetType, targetId, counts, mine });

  return (
    <>
      {options.map((r) => {
        const def = REACTIONS[r];
        const active = state.mine === r;
        return (
          <Action
            key={r}
            icon={active ? def.active : def.icon}
            color={def.color}
            count={state.counts[r]}
            label={def.label}
            selected={active}
            onPress={() => toggle(r)}
          />
        );
      })}
    </>
  );
}

/** Small colored pill naming a community. */
export function CommunityTag({ name, kind }: { name: string; kind: CommunityKind }) {
  return (
    <ThemedText
      type="caption"
      style={{ color: communityColor(kind), fontWeight: 700 }}
      numberOfLines={1}
    >
      {name}
    </ThemedText>
  );
}

/** A feed row: avatar, bold handle, community, time, title, body, actions. */
export function PostCard({ post, showCommunity = true }: { post: Post; showCommunity?: boolean }) {
  const router = useRouter();
  const theme = useTheme();
  const removed = post.status === 'removed';
  const open = () => router.push({ pathname: '/post/[id]', params: { id: post.id } });

  return (
    <View style={[styles.row, { borderBottomColor: theme.backgroundSelected }]}>
      {post.reason ? (
        <View style={styles.reason} accessibilityLabel={`Why you’re seeing this: ${post.reason}`}>
          <Ionicons name="information-circle-outline" size={14} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary">
            {post.reason}
          </ThemedText>
        </View>
      ) : null}
      <View style={styles.rowInner}>
        <Avatar name={post.author?.username ?? null} />
        <View style={styles.rowBody}>
          <Pressable accessibilityRole="link" onPress={open} style={styles.rowPress}>
            <View style={styles.meta}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {post.author ? post.author.username : 'deleted'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                · {timeAgo(post.createdAt)}
              </ThemedText>
              {showCommunity ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    ·
                  </ThemedText>
                  <CommunityTag name={post.community.name} kind={post.community.kind} />
                </>
              ) : null}
            </View>
            <ThemedText type="headline">{post.title}</ThemedText>
            {removed ? (
              <ThemedText type="small" themeColor="textSecondary">
                Removed by moderators ({post.removedReason?.replace(/_/g, ' ')}).
              </ThemedText>
            ) : post.body ? (
              <ThemedText numberOfLines={5} style={{ color: theme.text, opacity: 0.92 }}>
                {post.body}
              </ThemedText>
            ) : null}
          </Pressable>
          {!removed ? (
            <View style={styles.actions}>
              <Action
                icon="chatbubble-outline"
                color={Brand.primary}
                count={post.counts.comments}
                label="Comments"
                onPress={open}
              />
              <ReactionBar
                kind={post.community.kind}
                targetType="post"
                targetId={post.id}
                counts={post.counts}
                mine={post.myReaction}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
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
      style={({ pressed }) => [
        styles.follow,
        on
          ? {
              borderWidth: 1,
              borderColor: theme.backgroundSelected,
              backgroundColor: 'transparent',
            }
          : { backgroundColor: theme.text },
        pressed && { opacity: 0.8 },
      ]}
    >
      <ThemedText type="smallBold" style={on ? undefined : { color: theme.background }}>
        {kind === 'community' ? (on ? 'Joined' : 'Join') : on ? 'Following' : 'Follow'}
      </ThemedText>
    </Pressable>
  );
}

/** Horizontal row of community pills (like a stories row). */
export function PillRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pillRow}
    >
      {children}
    </ScrollView>
  );
}

export function Pill({
  label,
  color,
  onPress,
  selected = false,
}: {
  label: string;
  color: string;
  onPress: () => void;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          borderColor: selected ? color : theme.backgroundSelected,
          backgroundColor: selected ? color : theme.backgroundElement,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: selected ? '#fff' : color }]} />
      <ThemedText type="smallBold" style={selected ? { color: '#fff' } : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Comments as a thread: avatars, handles, replies indented under parents. */
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

  const render = (parent: string | null, depth: number): ReactNode =>
    (children.get(parent) ?? []).map((c) => (
      <View
        key={c.id}
        style={[styles.comment, depth > 0 && { marginLeft: Math.min(depth, 3) * 28 }]}
      >
        <View style={styles.rowInner}>
          <Avatar name={c.author?.username ?? null} size={depth > 0 ? 28 : 34} />
          <View style={[styles.rowBody, { borderBottomColor: theme.backgroundSelected }]}>
            <View style={styles.meta}>
              <ThemedText type="smallBold">{c.author ? c.author.username : 'deleted'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                · {timeAgo(c.createdAt)}
              </ThemedText>
            </View>
            <ThemedText>{c.body ?? '[removed]'}</ThemedText>
            {c.body !== null ? (
              <View style={styles.actions}>
                <ReactionBar
                  kind={kind}
                  targetType="comment"
                  targetId={c.id}
                  counts={{ like: c.likes, dislike: c.dislikes, kudos: c.kudos }}
                  mine={c.myReaction}
                />
                {onReply ? (
                  <Pressable accessibilityRole="button" onPress={() => onReply(c)} hitSlop={8}>
                    <ThemedText
                      type="caption"
                      themeColor="textSecondary"
                      style={{ fontWeight: 700 }}
                    >
                      Reply
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
        {render(c.id, depth + 1)}
      </View>
    ));

  return <View style={styles.thread}>{render(null, 0)}</View>;
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.one + 2,
  },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginLeft: 44 + Spacing.three,
  },
  rowInner: { flexDirection: 'row', gap: Spacing.three - 4 },
  rowBody: { flex: 1, gap: Spacing.one + 2, minWidth: 0 },
  rowPress: { gap: Spacing.one },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.five,
    marginTop: Spacing.one,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    minWidth: 44,
    paddingVertical: 2,
  },
  follow: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.four - 4,
    paddingVertical: Spacing.two,
    alignSelf: 'flex-start',
  },
  pillRow: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  thread: { gap: Spacing.three },
  comment: { gap: Spacing.three },
});
