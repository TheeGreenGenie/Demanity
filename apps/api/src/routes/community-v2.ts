import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import type { ResponseCache } from '../cache.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';
import { billSelect, billView, type BillRow } from './civic.js';

/**
 * Polls (R5), reposts (R15), feed preferences / recipes (R16), the weekly
 * Common Ground digest (R18), and the organization page (R22).
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const uuid = { type: 'string', format: 'uuid' } as const;
const idParam = { type: 'object', properties: { id: uuid } } as const;
const viewer = (req: FastifyRequest) => req.session?.accountId ?? null;

/** Votes at which Demanity must publicly respond to a proposal (docs/GOVERNANCE.md). */
export const ORG_RESPONSE_THRESHOLD = 100;

export interface FeedPrefs {
  mutedCommunities: string[];
  mutedAccounts: string[];
  includeUpdates: boolean;
  includeReposts: boolean;
  sort: 'new' | 'top_day';
}
const DEFAULT_PREFS: FeedPrefs = {
  mutedCommunities: [],
  mutedAccounts: [],
  includeUpdates: true,
  includeReposts: true,
  sort: 'new',
};

export async function loadFeedPrefs(pool: Pool, accountId: string): Promise<FeedPrefs> {
  const { rows } = await pool.query<{
    muted_communities: string[];
    muted_accounts: string[];
    include_updates: boolean;
    include_reposts: boolean;
    sort: 'new' | 'top_day';
  }>('SELECT * FROM feed_prefs WHERE account_id = $1', [accountId]);
  const r = rows[0];
  return r
    ? {
        mutedCommunities: r.muted_communities,
        mutedAccounts: r.muted_accounts,
        includeUpdates: r.include_updates,
        includeReposts: r.include_reposts,
        sort: r.sort,
      }
    : DEFAULT_PREFS;
}

/** A shareable recipe: everything except muted people (that stays personal). */
export function encodeRecipe(p: FeedPrefs): string {
  const shared = {
    mutedCommunities: p.mutedCommunities,
    includeUpdates: p.includeUpdates,
    includeReposts: p.includeReposts,
    sort: p.sort,
  };
  return Buffer.from(JSON.stringify({ v: 1, ...shared })).toString('base64url');
}
export function decodeRecipe(recipe: string): Omit<FeedPrefs, 'mutedAccounts'> | null {
  try {
    const r = JSON.parse(Buffer.from(recipe, 'base64url').toString()) as Record<string, unknown>;
    const muted = Array.isArray(r.mutedCommunities) ? r.mutedCommunities : [];
    if (r.v !== 1 || !muted.every((s) => typeof s === 'string' && /^[a-z0-9-]{2,60}$/.test(s)))
      return null;
    return {
      mutedCommunities: (muted as string[]).slice(0, 50),
      includeUpdates: r.includeUpdates !== false,
      includeReposts: r.includeReposts !== false,
      sort: r.sort === 'top_day' ? 'top_day' : 'new',
    };
  } catch {
    return null;
  }
}

export async function communityV2Routes(
  app: FastifyInstance,
  deps: { pool: Pool; limits: RouteLimits; cache: ResponseCache },
) {
  const { pool, limits, cache } = deps;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const moderatorOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await isModerator(pool, req.session!.accountId)))
      return reply.code(403).send({ error: 'moderator_only' });
  };

  // --- Polls ----------------------------------------------------------------------------

  app.post(
    '/v1/posts/:id/poll',
    {
      preHandler: member,
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'options'],
          properties: {
            question: { type: 'string', minLength: 5, maxLength: 300 },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 6,
              items: { type: 'string', minLength: 1, maxLength: 120 },
            },
            days: { type: 'integer', minimum: 1, maximum: 30, default: 7 },
          },
        },
      },
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const { question, options, days } = req.body as {
        question: string;
        options: string[];
        days: number;
      };
      const { rows } = await pool.query<{ author_id: string | null }>(
        "SELECT author_id FROM posts WHERE id = $1 AND status = 'visible'",
        [id],
      );
      if (!rows[0]) return notFound(reply);
      if (rows[0].author_id !== req.session!.accountId)
        return reply.code(403).send({ error: 'only_the_author_can_add_a_poll' });
      const labels = [...new Set(options.map((o) => o.trim()).filter(Boolean))];
      if (labels.length < 2) return reply.code(400).send({ error: 'need_two_options' });
      try {
        const { rows: poll } = await pool.query<{ id: string }>(
          `INSERT INTO polls (post_id, question, closes_at) VALUES ($1, $2, now() + make_interval(days => $3))
           RETURNING id`,
          [id, question.trim(), days],
        );
        for (const [seq, label] of labels.entries())
          await pool.query('INSERT INTO poll_options (poll_id, label, seq) VALUES ($1, $2, $3)', [
            poll[0]!.id,
            label,
            seq,
          ]);
        return reply.code(201).send({ id: poll[0]!.id });
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          return reply.code(409).send({ error: 'poll_exists' });
        throw err;
      }
    },
  );

  app.get('/v1/posts/:id/poll', { schema: { params: idParam } }, async (req, reply) => {
    const { rows } = await pool.query<{
      id: string;
      question: string;
      closes_at: Date;
      voted: boolean;
    }>(
      `SELECT p.id, p.question, p.closes_at,
              EXISTS (SELECT 1 FROM poll_ballots b WHERE b.poll_id = p.id AND b.account_id = $2) AS voted
         FROM polls p WHERE p.post_id = $1`,
      [(req.params as { id: string }).id, viewer(req)],
    );
    const poll = rows[0];
    if (!poll) return notFound(reply);
    const closed = poll.closes_at.getTime() <= Date.now();
    const show = poll.voted || closed;
    const { rows: opts } = await pool.query<{ id: string; label: string; votes: number }>(
      'SELECT id, label, votes FROM poll_options WHERE poll_id = $1 ORDER BY seq',
      [poll.id],
    );
    return {
      id: poll.id,
      question: poll.question,
      closesAt: poll.closes_at.toISOString(),
      closed,
      voted: poll.voted,
      total: show ? opts.reduce((n, o) => n + o.votes, 0) : null,
      options: opts.map((o) => ({ id: o.id, label: o.label, votes: show ? o.votes : null })),
      label: 'Demanity members choose to be here; results describe them, not all Americans.',
    };
  });

  app.post(
    '/v1/polls/:id/vote',
    {
      preHandler: member,
      config: { rateLimit: limits.stance },
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['optionId'],
          properties: { optionId: uuid },
        },
      },
    },
    async (req, reply) => {
      const pollId = (req.params as { id: string }).id;
      const { optionId } = req.body as { optionId: string };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ open: boolean }>(
          `SELECT p.closes_at > now() AS open FROM polls p JOIN poll_options o ON o.poll_id = p.id
            WHERE p.id = $1 AND o.id = $2`,
          [pollId, optionId],
        );
        if (!rows[0]) {
          await client.query('ROLLBACK');
          return notFound(reply);
        }
        if (!rows[0].open) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'poll_closed' });
        }
        const { rowCount } = await client.query(
          'INSERT INTO poll_ballots (account_id, poll_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.session!.accountId, pollId],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'already_voted' });
        }
        await client.query('UPDATE poll_options SET votes = votes + 1 WHERE id = $1', [optionId]);
        await client.query('COMMIT');
        return reply.code(201).send({ status: 'counted' });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // --- Reposts ----------------------------------------------------------------------------

  const repostBody = {
    type: 'object',
    additionalProperties: false,
    required: ['targetType', 'targetId'],
    properties: {
      targetType: { type: 'string', enum: ['post', 'bill', 'leader'] },
      targetId: uuid,
      comment: { type: 'string', maxLength: 500 },
    },
  } as const;
  const EXISTS_SQL: Record<string, string> = {
    post: "SELECT 1 FROM posts WHERE id = $1 AND status = 'visible'",
    bill: 'SELECT 1 FROM bills WHERE id = $1',
    leader: 'SELECT 1 FROM leaders WHERE id = $1',
  };

  app.put(
    '/v1/reposts',
    { preHandler: member, config: { rateLimit: limits.post }, schema: { body: repostBody } },
    async (req, reply) => {
      const { targetType, targetId, comment } = req.body as {
        targetType: string;
        targetId: string;
        comment?: string;
      };
      const { rowCount } = await pool.query(EXISTS_SQL[targetType]!, [targetId]);
      if (!rowCount) return notFound(reply);
      await pool.query(
        `INSERT INTO reposts (account_id, target_type, target_id, comment) VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, target_type, target_id) DO UPDATE SET comment = EXCLUDED.comment`,
        [req.session!.accountId, targetType, targetId, (comment ?? '').trim()],
      );
      return reply.code(204).send();
    },
  );

  app.delete(
    '/v1/reposts',
    {
      preHandler: member,
      schema: {
        body: {
          ...repostBody,
          properties: { targetType: repostBody.properties.targetType, targetId: uuid },
        },
      },
    },
    async (req, reply) => {
      const { targetType, targetId } = req.body as { targetType: string; targetId: string };
      await pool.query(
        'DELETE FROM reposts WHERE account_id = $1 AND target_type = $2 AND target_id = $3',
        [req.session!.accountId, targetType, targetId],
      );
      return reply.code(204).send();
    },
  );

  /** Reposts by people the viewer follows (first page of the feed). */
  app.get('/v1/feed/reposts', { preHandler: member }, async (req) => {
    const me = req.session!.accountId;
    const prefs = await loadFeedPrefs(pool, me);
    if (!prefs.includeReposts) return { reposts: [] };
    const { rows } = await pool.query<{
      id: string;
      username: string;
      target_type: string;
      target_id: string;
      comment: string;
      created_at: Date;
    }>(
      `SELECT r.id, a.username, r.target_type, r.target_id, r.comment, r.created_at
         FROM reposts r JOIN accounts a ON a.id = r.account_id
         JOIN follows f ON f.follower_id = $1 AND f.target_type = 'account' AND f.target_id = r.account_id
        WHERE NOT (a.username = ANY($2::text[]))
        ORDER BY r.created_at DESC LIMIT 15`,
      [me, prefs.mutedAccounts],
    );
    const out = [];
    for (const r of rows) {
      let target: unknown;
      if (r.target_type === 'post') {
        const { rows: p } = await pool.query(
          `SELECT p.id, p.title, c.slug AS "communitySlug", c.name AS "communityName"
             FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1 AND p.status = 'visible'`,
          [r.target_id],
        );
        target = p[0] ?? null;
      } else if (r.target_type === 'bill') {
        const { rows: b } = await pool.query<BillRow>(`${billSelect()} WHERE b.id = $2`, [
          me,
          r.target_id,
        ]);
        target = b[0] ? billView(b[0]) : null;
      } else {
        const { rows: l } = await pool.query(
          'SELECT slug, name, office, party FROM leaders WHERE id = $1',
          [r.target_id],
        );
        target = l[0] ?? null;
      }
      if (target)
        out.push({
          id: r.id,
          by: r.username,
          targetType: r.target_type,
          comment: r.comment,
          createdAt: r.created_at.toISOString(),
          target,
          reason: `@${r.username}, whom you follow, reposted this`,
        });
    }
    return { reposts: out };
  });

  // --- Feed preferences and recipes ------------------------------------------------------------

  app.get('/v1/me/feed-prefs', { preHandler: member }, async (req) => {
    const prefs = await loadFeedPrefs(pool, req.session!.accountId);
    return { ...prefs, recipe: encodeRecipe(prefs) };
  });

  app.put(
    '/v1/me/feed-prefs',
    {
      preHandler: member,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mutedCommunities: {
              type: 'array',
              maxItems: 50,
              items: { type: 'string', pattern: '^[a-z0-9-]{2,60}$' },
            },
            mutedAccounts: {
              type: 'array',
              maxItems: 200,
              items: { type: 'string', pattern: '^[a-z0-9_]{3,30}$' },
            },
            includeUpdates: { type: 'boolean' },
            includeReposts: { type: 'boolean' },
            sort: { type: 'string', enum: ['new', 'top_day'] },
            recipe: { type: 'string', maxLength: 4000 },
          },
        },
      },
    },
    async (req, reply) => {
      const me = req.session!.accountId;
      const body = req.body as Partial<FeedPrefs> & { recipe?: string };
      let next = { ...(await loadFeedPrefs(pool, me)) };
      if (body.recipe !== undefined) {
        const r = decodeRecipe(body.recipe);
        if (!r) return reply.code(400).send({ error: 'invalid_recipe' });
        next = { ...next, ...r };
      }
      for (const k of [
        'mutedCommunities',
        'mutedAccounts',
        'includeUpdates',
        'includeReposts',
        'sort',
      ] as const)
        if (body[k] !== undefined) (next as Record<string, unknown>)[k] = body[k];
      await pool.query(
        `INSERT INTO feed_prefs (account_id, muted_communities, muted_accounts, include_updates, include_reposts, sort)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (account_id) DO UPDATE SET muted_communities = EXCLUDED.muted_communities,
           muted_accounts = EXCLUDED.muted_accounts, include_updates = EXCLUDED.include_updates,
           include_reposts = EXCLUDED.include_reposts, sort = EXCLUDED.sort, updated_at = now()`,
        [
          me,
          next.mutedCommunities,
          next.mutedAccounts,
          next.includeUpdates,
          next.includeReposts,
          next.sort,
        ],
      );
      return { ...next, recipe: encodeRecipe(next) };
    },
  );

  // --- Weekly Common Ground digest (cached) -------------------------------------------------------

  app.get('/v1/digest/common-ground', async (req, reply) =>
    cache.serve(req, reply, 'digest:common-ground', async () => {
      const [bills, stories] = await Promise.all([
        pool.query<BillRow>(
          `SELECT * FROM (${billSelect()} WHERE b.last_action_at >= CURRENT_DATE - 7) x
            WHERE x.parties >= 2 ORDER BY x.last_action_at DESC LIMIT 10`,
          [null],
        ),
        pool.query(
          `SELECT p.id, p.title, a.username,
                  (SELECT count(*)::int FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.kind = 'kudos') AS kudos
             FROM posts p JOIN communities c ON c.id = p.community_id LEFT JOIN accounts a ON a.id = p.author_id
            WHERE c.kind = 'humanity' AND p.status = 'visible' AND p.created_at >= now() - interval '7 days'
            ORDER BY kudos DESC, p.created_at DESC LIMIT 5`,
        ),
      ]);
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 86_400_000);
      return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        bills: bills.rows.map(billView),
        stories: stories.rows,
        note: 'Bills sponsored across party lines with action this week, and the most-appreciated Humanity stories.',
      };
    }),
  );

  // --- Organization page (R22) -------------------------------------------------------------------

  app.get('/v1/org/proposals', async (req) => {
    const { rows } = await pool.query<{
      id: string;
      title: string;
      body: string;
      status: string;
      response: string | null;
      support: number;
      oppose: number;
      created_at: Date;
      responded_at: Date | null;
      voted: boolean;
    }>(
      `SELECT p.*, EXISTS (SELECT 1 FROM org_ballots b WHERE b.proposal_id = p.id AND b.account_id = $1) AS voted
         FROM org_proposals p ORDER BY p.created_at DESC LIMIT 50`,
      [viewer(req)],
    );
    return {
      threshold: ORG_RESPONSE_THRESHOLD,
      proposals: rows.map((p) => {
        const total = p.support + p.oppose;
        return {
          id: p.id,
          title: p.title,
          body: p.body,
          status: p.status,
          response: p.response,
          respondedAt: p.responded_at?.toISOString() ?? null,
          createdAt: p.created_at.toISOString(),
          voted: p.voted,
          // Counts after you vote (avoids bandwagons), or once Demanity has responded.
          tally: p.voted || p.status !== 'open' ? { support: p.support, oppose: p.oppose } : null,
          responseRequired: p.status === 'open' && total >= ORG_RESPONSE_THRESHOLD,
        };
      }),
    };
  });

  app.post(
    '/v1/org/proposals/:id/vote',
    {
      preHandler: member,
      config: { rateLimit: limits.stance },
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['stance'],
          properties: { stance: { type: 'string', enum: ['support', 'oppose'] } },
        },
      },
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const { stance } = req.body as { stance: 'support' | 'oppose' };
      const { rowCount: open } = await pool.query(
        "SELECT 1 FROM org_proposals WHERE id = $1 AND status = 'open'",
        [id],
      );
      if (!open) return notFound(reply);
      const { rowCount } = await pool.query(
        'INSERT INTO org_ballots (account_id, proposal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.session!.accountId, id],
      );
      if (!rowCount) return reply.code(409).send({ error: 'already_voted' });
      const col = stance === 'support' ? 'support' : 'oppose';
      await pool.query(`UPDATE org_proposals SET ${col} = ${col} + 1 WHERE id = $1`, [id]);
      return reply.code(201).send({ status: 'counted' });
    },
  );

  app.post(
    '/v1/moderation/org/proposals',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'body'],
          properties: {
            title: { type: 'string', minLength: 5, maxLength: 200 },
            body: { type: 'string', minLength: 20, maxLength: 6000 },
          },
        },
      },
    },
    async (req, reply) => {
      const { title, body } = req.body as { title: string; body: string };
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO org_proposals (title, body, created_by) VALUES ($1, $2, $3) RETURNING id',
        [title.trim(), body.trim(), req.session!.accountId],
      );
      await logAction(pool, {
        action: 'org.proposal_posted',
        reasonCode: REASON_CODES.org[0],
        actorAccountId: req.session!.accountId,
      });
      return reply.code(201).send({ id: rows[0]!.id });
    },
  );

  app.post(
    '/v1/moderation/org/proposals/:id/respond',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['response'],
          properties: { response: { type: 'string', minLength: 20, maxLength: 6000 } },
        },
      },
    },
    async (req, reply) => {
      const { rowCount } = await pool.query(
        `UPDATE org_proposals SET status = 'responded', response = $2, responded_at = now()
          WHERE id = $1 AND status = 'open'`,
        [(req.params as { id: string }).id, (req.body as { response: string }).response.trim()],
      );
      if (!rowCount) return notFound(reply);
      await logAction(pool, {
        action: 'org.responded',
        reasonCode: REASON_CODES.org[1],
        actorAccountId: req.session!.accountId,
      });
      return { status: 'responded' };
    },
  );
}
