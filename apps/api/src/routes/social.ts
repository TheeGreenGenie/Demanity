import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';
import { queries, type PostSort } from '../social/queries.js';
import { billSelect, billView, RELEVANCE_SQL, type BillRow } from './civic.js';

/**
 * Social core (R5, R8, R15, R16, R18). Guests can read everything; writing
 * requires a fully onboarded account (verified identity + confirmed 2FA,
 * signed in with a passkey).
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });

const uuid = { type: 'string', format: 'uuid' } as const;
const slug = { type: 'string', pattern: '^[a-z0-9-]{2,60}$' } as const;
const cursorQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { cursor: { type: 'string', maxLength: 200 } },
} as const;

const viewer = (req: FastifyRequest) => req.session?.accountId ?? null;

async function communityBySlug(pool: Pool, s: string) {
  const { rows } = await pool.query<{
    id: string;
    slug: string;
    name: string;
    kind: string;
    description: string;
  }>('SELECT id, slug, name, kind, description FROM communities WHERE slug = $1', [s]);
  return rows[0] ?? null;
}

export async function socialRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; limits: RouteLimits },
) {
  const { pool, limits } = deps;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

  // --- Communities -----------------------------------------------------------

  app.get(
    '/v1/communities',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { kind: { type: 'string', enum: ['topic', 'location', 'humanity'] } },
        },
      },
    },
    async (req) => {
      const { kind } = req.query as { kind?: string };
      const { rows } = await pool.query(
        `SELECT c.slug, c.name, c.kind, c.description,
                (SELECT count(*)::int FROM follows f WHERE f.target_type = 'community' AND f.target_id = c.id) AS followers,
                EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.target_type = 'community' AND f.target_id = c.id) AS following
           FROM communities c
          WHERE ($1::text IS NULL OR c.kind = $1)
          ORDER BY CASE c.kind WHEN 'humanity' THEN 0 WHEN 'location' THEN 1 ELSE 2 END, c.name`,
        [kind ?? null, viewer(req)],
      );
      return { communities: rows };
    },
  );

  app.get(
    '/v1/communities/:slug',
    { schema: { params: { type: 'object', properties: { slug } } } },
    async (req, reply) => {
      const c = await communityBySlug(pool, (req.params as { slug: string }).slug);
      if (!c) return notFound(reply);
      const { rows } = await pool.query<{
        followers: number;
        following: boolean;
        posts: number;
        place: string | null;
      }>(
        `SELECT (SELECT count(*)::int FROM follows WHERE target_type = 'community' AND target_id = $1) AS followers,
              EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND target_type = 'community' AND target_id = $1) AS following,
              (SELECT count(*)::int FROM posts WHERE community_id = $1 AND status = 'visible') AS posts,
              (SELECT slug FROM places WHERE community_id = $1) AS place`,
        [c.id, viewer(req)],
      );
      return { slug: c.slug, name: c.name, kind: c.kind, description: c.description, ...rows[0] };
    },
  );

  app.get(
    '/v1/communities/:slug/posts',
    {
      schema: {
        params: { type: 'object', properties: { slug } },
        querystring: {
          ...cursorQuery,
          properties: {
            ...cursorQuery.properties,
            sort: { type: 'string', enum: ['new', 'hot', 'top'] },
          },
        },
      },
    },
    async (req, reply) => {
      const c = await communityBySlug(pool, (req.params as { slug: string }).slug);
      if (!c) return notFound(reply);
      const { cursor, sort } = req.query as { cursor?: string; sort?: PostSort };
      const { posts, next } = await queries.communityPosts(pool, viewer(req), c.id, cursor, sort);
      return { posts, next };
    },
  );

  // --- Posts -------------------------------------------------------------------

  app.post(
    '/v1/communities/:slug/posts',
    {
      preHandler: member,
      config: { rateLimit: limits.post },
      schema: {
        params: { type: 'object', properties: { slug } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'body'],
          properties: {
            title: { type: 'string', minLength: 3, maxLength: 200 },
            body: { type: 'string', minLength: 1, maxLength: 20000 },
          },
        },
      },
    },
    async (req, reply) => {
      const c = await communityBySlug(pool, (req.params as { slug: string }).slug);
      if (!c) return notFound(reply);
      const { title, body } = req.body as { title: string; body: string };
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO posts (community_id, author_id, title, body) VALUES ($1, $2, $3, $4) RETURNING id',
        [c.id, req.session!.accountId, title.trim(), body.trim()],
      );
      return reply.code(201).send(await queries.post(pool, req.session!.accountId, rows[0]!.id));
    },
  );

  app.get(
    '/v1/posts/:id',
    { schema: { params: { type: 'object', properties: { id: uuid } } } },
    async (req, reply) => {
      const post = await queries.post(pool, viewer(req), (req.params as { id: string }).id);
      return post ?? notFound(reply);
    },
  );

  // --- Comments (threaded via parentId) ----------------------------------------

  app.get(
    '/v1/posts/:id/comments',
    { schema: { params: { type: 'object', properties: { id: uuid } } } },
    async (req) => {
      const { rows } = await pool.query(
        `SELECT m.id, m.parent_id AS "parentId", a.username, m.status, m.created_at AS "createdAt",
              CASE WHEN m.status = 'visible' THEN m.body ELSE NULL END AS body,
              (SELECT count(*)::int FROM reactions r WHERE r.target_type = 'comment' AND r.target_id = m.id AND r.kind = 'like') AS likes,
              (SELECT count(*)::int FROM reactions r WHERE r.target_type = 'comment' AND r.target_id = m.id AND r.kind = 'dislike') AS dislikes,
              (SELECT count(*)::int FROM reactions r WHERE r.target_type = 'comment' AND r.target_id = m.id AND r.kind = 'kudos') AS kudos,
              (SELECT r.kind FROM reactions r WHERE r.target_type = 'comment' AND r.target_id = m.id AND r.account_id = $2) AS "myReaction"
         FROM comments m LEFT JOIN accounts a ON a.id = m.author_id
        WHERE m.post_id = $1
        ORDER BY m.created_at`,
        [(req.params as { id: string }).id, viewer(req)],
      );
      return {
        comments: rows.map(({ username, ...c }) => ({
          ...c,
          author: username ? { username } : null,
        })),
      };
    },
  );

  app.post(
    '/v1/posts/:id/comments',
    {
      preHandler: member,
      config: { rateLimit: limits.comment },
      schema: {
        params: { type: 'object', properties: { id: uuid } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['body'],
          properties: { body: { type: 'string', minLength: 1, maxLength: 10000 }, parentId: uuid },
        },
      },
    },
    async (req, reply) => {
      const postId = (req.params as { id: string }).id;
      const { body, parentId } = req.body as { body: string; parentId?: string };
      const { rows: post } = await pool.query<{ status: string }>(
        'SELECT status FROM posts WHERE id = $1',
        [postId],
      );
      if (!post[0]) return notFound(reply);
      if (post[0].status !== 'visible') return reply.code(409).send({ error: 'post_removed' });
      if (parentId) {
        const { rowCount } = await pool.query(
          'SELECT 1 FROM comments WHERE id = $1 AND post_id = $2',
          [parentId, postId],
        );
        if (!rowCount) return reply.code(400).send({ error: 'parent_not_in_post' });
      }
      const { rows } = await pool.query(
        `INSERT INTO comments (post_id, parent_id, author_id, body) VALUES ($1, $2, $3, $4)
         RETURNING id, parent_id AS "parentId", body, created_at AS "createdAt"`,
        [postId, parentId ?? null, req.session!.accountId, body.trim()],
      );
      return reply.code(201).send({ ...rows[0], author: { username: req.session!.username } });
    },
  );

  // --- Reactions -----------------------------------------------------------------

  const reactionTarget = {
    type: 'object',
    additionalProperties: false,
    required: ['targetType', 'targetId'],
    properties: { targetType: { type: 'string', enum: ['post', 'comment'] }, targetId: uuid },
  } as const;

  /** The community a reaction target belongs to, or null if it doesn't exist. */
  async function targetKind(targetType: string, targetId: string): Promise<string | null> {
    const sql =
      targetType === 'post'
        ? 'SELECT c.kind FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1'
        : 'SELECT c.kind FROM comments m JOIN posts p ON p.id = m.post_id JOIN communities c ON c.id = p.community_id WHERE m.id = $1';
    const { rows } = await pool.query<{ kind: string }>(sql, [targetId]);
    return rows[0]?.kind ?? null;
  }

  app.put(
    '/v1/reactions',
    {
      preHandler: member,
      schema: {
        body: {
          ...reactionTarget,
          required: [...reactionTarget.required, 'kind'],
          properties: {
            ...reactionTarget.properties,
            kind: { type: 'string', enum: ['like', 'dislike', 'kudos'] },
          },
        },
      },
    },
    async (req, reply) => {
      const { targetType, targetId, kind } = req.body as {
        targetType: string;
        targetId: string;
        kind: string;
      };
      const communityKind = await targetKind(targetType, targetId);
      if (!communityKind) return notFound(reply);
      // Humanity is kudos-only (no dislikes); everywhere else is like/dislike.
      const allowed = communityKind === 'humanity' ? ['kudos'] : ['like', 'dislike'];
      if (!allowed.includes(kind))
        return reply.code(400).send({ error: 'reaction_not_allowed_here', allowed });
      await pool.query(
        `INSERT INTO reactions (account_id, target_type, target_id, kind) VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, target_type, target_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now()`,
        [req.session!.accountId, targetType, targetId, kind],
      );
      return reply.code(204).send();
    },
  );

  app.delete(
    '/v1/reactions',
    { preHandler: member, schema: { body: reactionTarget } },
    async (req, reply) => {
      const { targetType, targetId } = req.body as { targetType: string; targetId: string };
      await pool.query(
        'DELETE FROM reactions WHERE account_id = $1 AND target_type = $2 AND target_id = $3',
        [req.session!.accountId, targetType, targetId],
      );
      return reply.code(204).send();
    },
  );

  // --- Follows -------------------------------------------------------------------

  const followParams = {
    type: 'object',
    required: ['kind', 'name'],
    properties: {
      kind: { type: 'string', enum: ['community', 'user', 'leader', 'place', 'bill'] },
      name: { type: 'string', maxLength: 80 },
    },
  } as const;

  async function followTarget(
    kind: string,
    name: string,
  ): Promise<{ type: string; id: string } | null> {
    if (kind === 'community') {
      const c = await communityBySlug(pool, name);
      return c ? { type: 'community', id: c.id } : null;
    }
    const sql: Record<string, [string, string]> = {
      user: ['account', "SELECT id FROM accounts WHERE username = $1 AND status = 'active'"],
      leader: ['leader', 'SELECT id FROM leaders WHERE slug = $1'],
      place: ['place', 'SELECT id FROM places WHERE slug = $1'],
      bill: ['bill', "SELECT id FROM bills WHERE id::text = $1 AND $1 ~ '^[0-9a-f-]{36}$'"],
    };
    const [type, query] = sql[kind]!;
    const { rows } = await pool.query<{ id: string }>(query, [name]);
    return rows[0] ? { type, id: rows[0].id } : null;
  }

  // Whether the viewer follows something (kept separate so public pages can be cached).
  app.get('/v1/follows/:kind/:name', { schema: { params: followParams } }, async (req, reply) => {
    const { kind, name } = req.params as { kind: string; name: string };
    const target = await followTarget(kind, name);
    if (!target) return notFound(reply);
    const me = viewer(req);
    if (!me) return { following: false };
    const { rowCount } = await pool.query(
      'SELECT 1 FROM follows WHERE follower_id = $1 AND target_type = $2 AND target_id = $3',
      [me, target.type, target.id],
    );
    return { following: (rowCount ?? 0) > 0 };
  });

  app.put(
    '/v1/follows/:kind/:name',
    { preHandler: member, schema: { params: followParams } },
    async (req, reply) => {
      const { kind, name } = req.params as { kind: string; name: string };
      const target = await followTarget(kind, name);
      if (!target) return notFound(reply);
      if (target.type === 'account' && target.id === req.session!.accountId) {
        return reply.code(400).send({ error: 'cannot_follow_self' });
      }
      await pool.query(
        'INSERT INTO follows (follower_id, target_type, target_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [req.session!.accountId, target.type, target.id],
      );
      return reply.code(204).send();
    },
  );

  app.delete(
    '/v1/follows/:kind/:name',
    { preHandler: member, schema: { params: followParams } },
    async (req, reply) => {
      const { kind, name } = req.params as { kind: string; name: string };
      const target = await followTarget(kind, name);
      if (!target) return notFound(reply);
      await pool.query(
        'DELETE FROM follows WHERE follower_id = $1 AND target_type = $2 AND target_id = $3',
        [req.session!.accountId, target.type, target.id],
      );
      return reply.code(204).send();
    },
  );

  // --- Feed and profiles -----------------------------------------------------------

  /**
   * Feed: posts from followed communities and people (paged), plus, on the
   * first page only, recent bill activity from followed leaders, places, bills
   * and topics, and the list of followed leaders, places and bills. Each
   * update carries the reason it is shown.
   */
  app.get('/v1/feed', { preHandler: member, schema: { querystring: cursorQuery } }, async (req) => {
    const me = req.session!.accountId;
    const cursor = (req.query as { cursor?: string }).cursor;
    const page = await queries.feed(pool, me, cursor);
    if (cursor) return page;
    const [updates, following] = await Promise.all([
      pool.query<BillRow>(
        `SELECT * FROM (${billSelect(`, ${RELEVANCE_SQL} AS reason`)}
           WHERE b.last_action_at >= CURRENT_DATE - 60) y
          WHERE y.reason IS NOT NULL ORDER BY y.last_action_at DESC, y.id DESC LIMIT 10`,
        [me],
      ),
      pool.query(
        `SELECT 'leader' AS kind, l.slug AS id, l.name, l.office AS caption
           FROM follows f JOIN leaders l ON l.id = f.target_id
          WHERE f.follower_id = $1 AND f.target_type = 'leader'
         UNION ALL
         SELECT 'place', p.slug, p.name, p.kind
           FROM follows f JOIN places p ON (f.target_type = 'place' AND p.id = f.target_id)
                                        OR (f.target_type = 'community' AND p.community_id = f.target_id)
          WHERE f.follower_id = $1
         UNION ALL
         SELECT 'bill', b.id::text, b.title, b.number
           FROM follows f JOIN bills b ON b.id = f.target_id
          WHERE f.follower_id = $1 AND f.target_type = 'bill'`,
        [me],
      ),
    ]);
    return { ...page, updates: updates.rows.map(billView), following: following.rows };
  });

  app.get(
    '/v1/users/:username',
    {
      schema: {
        params: { type: 'object', properties: { username: { type: 'string', maxLength: 30 } } },
      },
    },
    async (req, reply) => {
      const { rows } = await pool.query<{
        id: string;
        username: string;
        created_at: Date;
        followers: number;
        following: boolean;
      }>(
        `SELECT a.id, a.username, a.created_at,
                (SELECT count(*)::int FROM follows f WHERE f.target_type = 'account' AND f.target_id = a.id) AS followers,
                EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.target_type = 'account' AND f.target_id = a.id) AS following
           FROM accounts a WHERE a.username = $1 AND a.status = 'active'`,
        [(req.params as { username: string }).username, viewer(req)],
      );
      const u = rows[0];
      if (!u) return notFound(reply);
      const { posts, next } = await queries.userPosts(pool, viewer(req), u.id);
      return {
        username: u.username,
        joined: u.created_at.toISOString().slice(0, 7), // month only: minimal disclosure
        followers: u.followers,
        following: u.following,
        posts,
        next,
      };
    },
  );

  // --- Moderation: remove content (clear policy violations only) ---------------------

  app.post(
    '/v1/moderation/posts/:id/remove',
    {
      preHandler: [
        member,
        async (req, reply) => {
          if (!(await isModerator(pool, req.session!.accountId))) {
            return reply.code(403).send({ error: 'moderator_only' });
          }
        },
      ],
      schema: {
        params: { type: 'object', properties: { id: uuid } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reasonCode'],
          properties: { reasonCode: { type: 'string', enum: [...REASON_CODES.content] } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { reasonCode } = req.body as { reasonCode: string };
      const { rows: found } = await pool.query<{ author_id: string | null }>(
        "SELECT author_id FROM posts WHERE id = $1 AND status = 'visible'",
        [id],
      );
      if (!found[0]) return notFound(reply);
      // Moderators may not act on their own content.
      if (found[0].author_id === req.session!.accountId) {
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      }
      const { rowCount } = await pool.query(
        "UPDATE posts SET status = 'removed', removed_reason = $2 WHERE id = $1 AND status = 'visible'",
        [id, reasonCode],
      );
      if (!rowCount) return notFound(reply); // removed concurrently
      await logAction(pool, {
        action: 'post.removed',
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      return { status: 'removed' };
    },
  );
}
