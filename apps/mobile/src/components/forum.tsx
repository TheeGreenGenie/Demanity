import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { communityColor, REACTION_DEFS, timeAgo, useReaction } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Comment, CommunityKind, Post, ReactionKind } from '@/lib/api';

/**
 * Forum (Reddit-style) building blocks: community icons, card-style posts with
 * a vote pill, and threaded comments with collapsible thread lines.
 */

type IconName = ComponentProps<typeof Ionicons>['name'];

const KIND_ICON: Record<CommunityKind, IconName> = {
  topic: 'chatbubbles',
  location: 'location',
  humanity: 'heart',
};

export function CommunityIcon({ kind, size = 32 }: { kind: CommunityKind; size?: number }) {
  return (
    <View
      style={[
        styles.icon,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: communityColor(kind),
        },
      ]}
    >
      <Ionicons name={KIND_ICON[kind]} size={size * 0.55} color="#fff" />
    </View>
  );
}

/** A pill-shaped action (comments count, etc.). */
export function ActionPill({
  icon,
  label,
  accessibilityLabel,
  onPress,
}: {
  icon: IconName;
  label: string;
  accessibilityLabel?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}
    >
      <Ionicons name={icon} size={17} color={theme.text} />
      <ThemedText type="caption" style={styles.pillText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * Vote pill: like ▲ · net score · ▼ dislike (or a single kudos pill in
 * Humanity). Each side is its own accessible button with its own count.
 */
export function VotePill({
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
  const theme = useTheme();
  const { state, options, toggle } = useReaction({ kind, targetType, targetId, counts, mine });

  if (kind === 'humanity') {
    const active = state.mine === 'kudos';
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Kudos (${state.counts.kudos})`}
        accessibilityState={{ selected: active }}
        onPress={() => toggle('kudos')}
        style={({ pressed }) => [
          styles.pill,
          {
            backgroundColor: active
              ? Brand.kudos
              : pressed
                ? theme.backgroundSelected
                : theme.backgroundElement,
          },
        ]}
      >
        <Ionicons
          name={active ? 'sparkles' : 'sparkles-outline'}
          size={17}
          color={active ? '#000' : Brand.kudos}
        />
        <ThemedText type="caption" style={[styles.pillText, active && { color: '#000' }]}>
          {state.counts.kudos > 0 ? state.counts.kudos : 'Kudos'}
        </ThemedText>
      </Pressable>
    );
  }

  const net = state.counts.like - state.counts.dislike;
  const tint =
    state.mine === 'like' ? Brand.like : state.mine === 'dislike' ? Brand.dislike : theme.text;
  return (
    <View style={[styles.pill, styles.vote, { backgroundColor: theme.backgroundElement }]}>
      {options.map((r, i) => {
        const def = REACTION_DEFS[r];
        const active = state.mine === r;
        const button = (
          <Pressable
            key={r}
            accessibilityRole="button"
            accessibilityLabel={`${def.label} (${state.counts[r]})`}
            accessibilityState={{ selected: active }}
            onPress={() => toggle(r)}
            hitSlop={6}
            style={({ pressed }) => [styles.voteBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons
              name={
                r === 'like'
                  ? active
                    ? 'arrow-up-circle'
                    : 'arrow-up-circle-outline'
                  : active
                    ? 'arrow-down-circle'
                    : 'arrow-down-circle-outline'
              }
              size={20}
              color={active ? def.color : theme.text}
            />
          </Pressable>
        );
        return i === 0 ? (
          <View key={r} style={styles.voteSide}>
            {button}
            <ThemedText
              type="caption"
              style={[styles.pillText, { color: tint, minWidth: 18, textAlign: 'center' }]}
            >
              {net}
            </ThemedText>
          </View>
        ) : (
          button
        );
      })}
    </View>
  );
}

/** Reddit-style post card: community · author · time, bold title, preview, action pills. */
export function ForumPostCard({
  post,
  showCommunity = true,
}: {
  post: Post;
  showCommunity?: boolean;
}) {
  const router = useRouter();
  const theme = useTheme();
  const removed = post.status === 'removed';
  const open = () => router.push({ pathname: '/post/[id]', params: { id: post.id } });

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.background, borderBottomColor: theme.backgroundSelected },
      ]}
    >
      <Pressable accessibilityRole="link" onPress={open} style={styles.cardPress}>
        <View style={styles.cardMeta}>
          {showCommunity ? (
            <>
              <CommunityIcon kind={post.community.kind} size={22} />
              <ThemedText type="caption" style={styles.bold}>
                {post.community.name}
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                ·
              </ThemedText>
            </>
          ) : (
            <Avatar name={post.author?.username ?? null} size={22} />
          )}
          <ThemedText type="caption" themeColor="textSecondary">
            {post.author ? `u/${post.author.username}` : 'deleted'} · {timeAgo(post.createdAt)}
          </ThemedText>
        </View>
        <ThemedText type="headline" style={styles.cardTitle}>
          {post.title}
        </ThemedText>
        {removed ? (
          <ThemedText type="small" themeColor="textSecondary">
            Removed by moderators ({post.removedReason?.replace(/_/g, ' ')}).
          </ThemedText>
        ) : post.body ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
            {post.body}
          </ThemedText>
        ) : null}
      </Pressable>
      {!removed ? (
        <View style={styles.cardActions}>
          <VotePill
            kind={post.community.kind}
            targetType="post"
            targetId={post.id}
            counts={post.counts}
            mine={post.myReaction}
          />
          <ActionPill
            icon="chatbubble-outline"
            label={String(post.counts.comments)}
            accessibilityLabel={`Comments (${post.counts.comments})`}
            onPress={open}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Comment threads with thread lines; tap a line (or "collapse") to fold a branch. */
export function ThreadedComments({
  comments,
  kind,
  onReply,
  renderExtra,
}: {
  comments: Comment[];
  kind: CommunityKind;
  onReply?: (c: Comment) => void;
  /** Extra controls under a comment (moderator tools, appeal link). */
  renderExtra?: (c: Comment) => ReactNode;
}) {
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const children = new Map<string | null, Comment[]>();
  for (const c of comments) {
    const list = children.get(c.parentId) ?? [];
    list.push(c);
    children.set(c.parentId, list);
  }
  const count = (id: string): number =>
    (children.get(id) ?? []).reduce((n, c) => n + 1 + count(c.id), 0);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const render = (parent: string | null): ReactNode =>
    (children.get(parent) ?? []).map((c) => {
      const isCollapsed = collapsed.has(c.id);
      const replies = count(c.id);
      return (
        <View key={c.id} style={styles.comment}>
          <View style={styles.cardMeta}>
            <Avatar name={c.author?.username ?? null} size={24} />
            <ThemedText type="caption" style={styles.bold}>
              {c.author ? c.author.username : 'deleted'}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              · {timeAgo(c.createdAt)}
            </ThemedText>
            {isCollapsed && replies > 0 ? (
              <ThemedText type="caption" themeColor="textSecondary">
                · {replies} hidden
              </ThemedText>
            ) : null}
          </View>
          {!isCollapsed ? (
            <View style={styles.branch}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Collapse thread"
                onPress={() => toggle(c.id)}
                hitSlop={{ left: 10, right: 10 }}
                style={styles.lineHit}
              >
                <View style={[styles.line, { backgroundColor: theme.backgroundSelected }]} />
              </Pressable>
              <View style={styles.branchBody}>
                <ThemedText>{c.body ?? '[removed]'}</ThemedText>
                {c.body !== null ? (
                  <View style={styles.commentActions}>
                    <VotePill
                      kind={kind}
                      targetType="comment"
                      targetId={c.id}
                      counts={{ like: c.likes, dislike: c.dislikes, kudos: c.kudos }}
                      mine={c.myReaction}
                    />
                    {onReply ? (
                      <ActionPill
                        icon="arrow-undo-outline"
                        label="Reply"
                        onPress={() => onReply(c)}
                      />
                    ) : null}
                  </View>
                ) : null}
                {renderExtra?.(c)}
                {render(c.id)}
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Expand thread"
              onPress={() => toggle(c.id)}
            >
              <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 700 }}>
                Show thread
              </ThemedText>
            </Pressable>
          )}
        </View>
      );
    });

  return <View style={styles.thread}>{render(null)}</View>;
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.one + 2,
    alignSelf: 'flex-start',
  },
  pillText: { fontWeight: 800 },
  vote: { paddingHorizontal: Spacing.two, gap: Spacing.one },
  voteSide: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  voteBtn: { padding: 2 },
  card: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two + 2,
  },
  cardPress: { gap: Spacing.two },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2, flexWrap: 'wrap' },
  cardTitle: { fontSize: 19, lineHeight: 25 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bold: { fontWeight: 800 },
  thread: { gap: Spacing.three, paddingHorizontal: Spacing.three },
  comment: { gap: Spacing.one + 2 },
  branch: { flexDirection: 'row' },
  lineHit: { width: 24, alignItems: 'center' },
  line: { width: 2, flex: 1, borderRadius: 1 },
  branchBody: { flex: 1, gap: Spacing.two, paddingLeft: Spacing.one },
  commentActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
