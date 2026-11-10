import type { Pool } from '@demanity/db';

/**
 * Read models for the social core. Every list is reverse-chronological with a
 * keyset cursor (no hidden ranking), and every post carries public counts plus
 * the viewer's own reaction when signed in.
 */

export interface PostView {
  id: string;
  community: { slug: string; name: string; kind: 'topic' | 'location' | 'humanity' };
  author: { username: string } | null;
  title: string;
  body: string | null; // null when removed
  status: 'visible' | 'removed';
  removedReason: string | null;
  createdAt: string;
  counts: { like: number; dislike: number; kudos: number; comments: number };
  myReaction: 'like' | 'dislike' | 'kudos' | null;
  reason?: string; // feed only: why this item is shown
}

interface PostRow {
  id: string;
  slug: string;
  community_name: string;
  kind: PostView['community']['kind'];
  username: string | null;
  title: string;
  body: string;
  status: PostView['status'];
  removed_reason: string | null;
  created_at: Date;
  likes: number;
  dislikes: number;
  kudos: number;
  comment_count: number;
  my_reaction: PostView['myReaction'];
  followed_community: boolean;
  followed_author: boolean;
}

const POST_SELECT = `
  SELECT p.id, c.slug, c.name AS community_name, c.kind, a.username, p.title, p.body,
         p.status, p.removed_reason, p.created_at,
         (SELECT count(*)::int FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.kind = 'like') AS likes,
         (SELECT count(*)::int FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.kind = 'dislike') AS dislikes,
         (SELECT count(*)::int FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.kind = 'kudos') AS kudos,
         (SELECT count(*)::int FROM comments m WHERE m.post_id = p.id AND m.status = 'visible') AS comment_count,
         (SELECT r.kind FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.account_id = $1) AS my_reaction,
         EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.target_type = 'community' AND f.target_id = c.id) AS followed_community,
         EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.target_type = 'account' AND f.target_id = p.author_id) AS followed_author
    FROM posts p
    JOIN communities c ON c.id = p.community_id
    LEFT JOIN accounts a ON a.id = p.author_id`;

function toView(r: PostRow): PostView {
  const removed = r.status === 'removed';
  return {
    id: r.id,
    community: { slug: r.slug, name: r.community_name, kind: r.kind },
    author: r.username ? { username: r.username } : null,
    title: removed ? '[removed]' : r.title,
    body: removed ? null : r.body,
    status: r.status,
    removedReason: removed ? r.removed_reason : null,
    createdAt: r.created_at.toISOString(),
    counts: { like: r.likes, dislike: r.dislikes, kudos: r.kudos, comments: r.comment_count },
    myReaction: r.my_reaction,
  };
}

/** Keyset cursor "<iso timestamp>|<uuid>" encoded as base64url. */
export function encodeCursor(p: { createdAt: string; id: string }): string {
  return Buffer.from(`${p.createdAt}|${p.id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const date = new Date(at ?? '');
  if (Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? '')) return null;
  return { at: date, id: id! };
}

const PAGE = 20;

async function listPosts(
  pool: Pool,
  viewerId: string | null,
  where: string,
  params: unknown[],
  cursor: string | undefined,
): Promise<{ posts: PostView[]; next: string | null; rows: PostRow[] }> {
  const c = decodeCursor(cursor);
  const base = [viewerId, ...params];
  const cursorClause = c
    ? ` AND (p.created_at, p.id) < ($${base.length + 1}::timestamptz, $${base.length + 2}::uuid)`
    : '';
  const { rows } = await pool.query<PostRow>(
    `${POST_SELECT} WHERE ${where}${cursorClause} ORDER BY p.created_at DESC, p.id DESC LIMIT ${PAGE + 1}`,
    c ? [...base, c.at, c.id] : base,
  );
  const page = rows.slice(0, PAGE);
  const posts = page.map(toView);
  const last = posts[posts.length - 1];
  return { posts, next: rows.length > PAGE && last ? encodeCursor(last) : null, rows: page };
}

export type PostSort = 'new' | 'hot' | 'top';

/**
 * Published ranking formulas for the optional Hot and Top sorts (New stays
 * the default; nothing is ranked behind the user's back):
 * - top: net votes = likes - dislikes + kudos, ties broken by newest.
 * - hot: (net votes + 1) / (age in hours + 2)^1.5, so newer posts with the
 *   same votes rank higher (the "gravity" approach used by many forums).
 */
export const SORT_FORMULAS: Record<Exclude<PostSort, 'new'>, string> = {
  top: '(x.likes - x.dislikes + x.kudos) DESC, x.created_at DESC, x.id DESC',
  hot: `(x.likes - x.dislikes + x.kudos + 1) / power(extract(epoch FROM now() - x.created_at) / 3600 + 2, 1.5) DESC, x.created_at DESC, x.id DESC`,
};

/** Hot/Top pages use an offset cursor ("o:<n>"), since scores change over time. */
async function rankedPosts(
  pool: Pool,
  viewerId: string | null,
  where: string,
  params: unknown[],
  sort: Exclude<PostSort, 'new'>,
  cursor: string | undefined,
) {
  const decoded = cursor ? Buffer.from(cursor, 'base64url').toString() : 'o:0';
  const offset = /^o:(\d{1,5})$/.exec(decoded)?.[1];
  const start = offset ? Number(offset) : 0;
  const { rows } = await pool.query<PostRow>(
    `SELECT * FROM (${POST_SELECT} WHERE ${where}) x ORDER BY ${SORT_FORMULAS[sort]}
      LIMIT ${PAGE + 1} OFFSET ${start}`,
    [viewerId, ...params],
  );
  const posts = rows.slice(0, PAGE).map(toView);
  return {
    posts,
    next: rows.length > PAGE ? Buffer.from(`o:${start + PAGE}`).toString('base64url') : null,
  };
}

export const queries = {
  communityPosts: (
    pool: Pool,
    viewerId: string | null,
    communityId: string,
    cursor?: string,
    sort: PostSort = 'new',
  ) =>
    sort === 'new'
      ? listPosts(pool, viewerId, 'p.community_id = $2', [communityId], cursor)
      : rankedPosts(pool, viewerId, 'p.community_id = $2', [communityId], sort, cursor),

  billPosts: (pool: Pool, viewerId: string | null, billId: string, cursor?: string) =>
    listPosts(pool, viewerId, 'p.bill_id = $2', [billId], cursor).then(({ posts, next }) => ({
      posts,
      next,
    })),

  userPosts: (pool: Pool, viewerId: string | null, authorId: string, cursor?: string) =>
    listPosts(pool, viewerId, 'p.author_id = $2', [authorId], cursor),

  async post(pool: Pool, viewerId: string | null, postId: string): Promise<PostView | null> {
    const { rows } = await pool.query<PostRow>(`${POST_SELECT} WHERE p.id = $2`, [
      viewerId,
      postId,
    ]);
    return rows[0] ? toView(rows[0]) : null;
  },

  /**
   * Default feed (R16): posts from followed communities and people, newest
   * first, each labelled with why it is shown. With no follows, it shows
   * recent posts from across Demanity and says so.
   */
  async feed(pool: Pool, viewerId: string, cursor?: string) {
    const { rows: n } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM follows WHERE follower_id = $1',
      [viewerId],
    );
    if ((n[0]?.n ?? 0) === 0) {
      const result = await listPosts(pool, viewerId, 'TRUE', [], cursor);
      return {
        posts: result.posts.map((p) => ({
          ...p,
          reason: 'Recent across Demanity (you follow nothing yet)',
        })),
        next: result.next,
      };
    }
    const result = await listPosts(
      pool,
      viewerId,
      `(EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.target_type = 'community' AND f.target_id = p.community_id)
        OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.target_type = 'account' AND f.target_id = p.author_id))`,
      [],
      cursor,
    );
    return {
      posts: result.posts.map((p, i) => {
        const row = result.rows[i]!;
        const reason = row.followed_community
          ? `You follow ${p.community.name}`
          : `You follow @${p.author?.username ?? 'someone'}`;
        return { ...p, reason };
      }),
      next: result.next,
    };
  },
};
