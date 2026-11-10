import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { CONTRIBUTION_V1 } from '../civic/contribution.js';
import { matchSource, wilsonLowerBound } from '../civic/trust.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';

/**
 * "Does this citation offend you?" (R29; docs/MODERATION.md §6), an opt-in
 * page of devil's-advocate entries written by contributors in the citation's
 * category, plus citation takedowns and contribution scores (SCORING.md §5).
 *
 * - Entries cite an approved source (R33) and are shown unattributed.
 * - Members vote "helpful?" once per entry; only totals are stored.
 * - Helpful entries raise the author's contribution score; removed entries
 *   and removed citations are takedowns that lower it.
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const uuid = { type: 'string', format: 'uuid' } as const;
const idParam = { type: 'object', properties: { id: uuid } } as const;

export const PERSPECTIVES_INTRO =
  'People live in different circumstances, with different needs and experiences. Reasonable people can look at the same record and weigh it differently. Here are some reasons this citation may not reflect your view, written by contributors in this category.';

export async function perspectiveRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; limits: RouteLimits },
) {
  const { pool, limits } = deps;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const markDirty = () => pool.query('UPDATE data_version SET dirty = true');
  const moderatorOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await isModerator(pool, req.session!.accountId)))
      return reply.code(403).send({ error: 'moderator_only' });
  };

  app.get('/v1/citations/:id/perspectives', { schema: { params: idParam } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows: c } = await pool.query<{ claim: string; category: string; leader: string }>(
      `SELECT c.claim, cat.name AS category, l.name AS leader FROM citations c
         JOIN communities cat ON cat.id = c.category_id JOIN leaders l ON l.id = c.leader_id
        WHERE c.id = $1 AND c.status = 'accepted'`,
      [id],
    );
    if (!c[0]) return notFound(reply);
    const viewer = req.session?.accountId ?? null;
    const { rows } = await pool.query<{
      id: string;
      body: string;
      source_url: string;
      source_name: string;
      helpful_yes: number;
      helpful_no: number;
      created_at: Date;
      voted: boolean;
      mine: boolean;
    }>(
      `SELECT p.id, p.body, p.source_url, s.name AS source_name, p.helpful_yes, p.helpful_no, p.created_at,
              ($2::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM perspective_vote_markers m
                 WHERE m.perspective_id = p.id AND m.account_id = $2::uuid)) AS voted,
              (p.author_id IS NOT DISTINCT FROM $2::uuid) AS mine
         FROM citation_perspectives p JOIN approved_sources s ON s.domain = p.source_domain
        WHERE p.citation_id = $1 AND p.status = 'visible'`,
      [id, viewer],
    );
    const entries = rows
      .map((r) => ({
        id: r.id,
        body: r.body,
        sourceUrl: r.source_url,
        sourceName: r.source_name,
        helpful: r.helpful_yes,
        votes: r.helpful_yes + r.helpful_no,
        rank: wilsonLowerBound(r.helpful_yes, r.helpful_yes + r.helpful_no),
        createdAt: r.created_at,
        voted: r.voted,
        mine: viewer !== null && r.mine,
      }))
      .sort((a, b) => b.rank - a.rank);
    return { citation: c[0], intro: PERSPECTIVES_INTRO, entries };
  });

  app.post(
    '/v1/citations/:id/perspectives',
    {
      preHandler: member,
      config: { rateLimit: limits.post },
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['body', 'sourceUrl'],
          properties: {
            body: { type: 'string', minLength: 40, maxLength: 1500 },
            sourceUrl: { type: 'string', minLength: 10, maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as { body: string; sourceUrl: string };
      const me = req.session!.accountId;
      const { rows: c } = await pool.query<{ category_id: string; submitted_by: string | null }>(
        "SELECT category_id, submitted_by FROM citations WHERE id = $1 AND status = 'accepted'",
        [id],
      );
      if (!c[0]) return notFound(reply);
      if (c[0].submitted_by === me) return reply.code(403).send({ error: 'own_citation' });
      const grant = await pool.query(
        'SELECT 1 FROM contributor_grants WHERE account_id = $1 AND category_id = $2 AND expires_at > now()',
        [me, c[0].category_id],
      );
      if (!grant.rows.length && !(await isModerator(pool, me)))
        return reply.code(403).send({ error: 'contributors_only' });
      const { rows: domains } = await pool.query<{ domain: string }>(
        'SELECT domain FROM approved_sources',
      );
      const domain = matchSource(
        b.sourceUrl,
        domains.map((d) => d.domain),
      );
      if (!domain) return reply.code(422).send({ error: 'source_not_approved' });
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO citation_perspectives (citation_id, author_id, body, source_url, source_domain)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
        [id, me, b.body.trim(), b.sourceUrl, domain],
      );
      if (!rows[0]) return reply.code(409).send({ error: 'already_contributed' });
      return reply.code(201).send({ id: rows[0].id });
    },
  );

  app.post(
    '/v1/perspectives/:id/vote',
    {
      preHandler: member,
      config: { rateLimit: limits.stance },
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['helpful'],
          properties: { helpful: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { helpful } = req.body as { helpful: boolean };
      const me = req.session!.accountId;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ author_id: string | null }>(
          "SELECT author_id FROM citation_perspectives WHERE id = $1 AND status = 'visible'",
          [id],
        );
        if (!rows[0]) {
          await client.query('ROLLBACK');
          return notFound(reply);
        }
        if (rows[0].author_id === me) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'own_entry' });
        }
        const { rowCount } = await client.query(
          'INSERT INTO perspective_vote_markers (account_id, perspective_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [me, id],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'already_voted' });
        }
        await client.query(
          `UPDATE citation_perspectives SET ${helpful ? 'helpful_yes = helpful_yes + 1' : 'helpful_no = helpful_no + 1'} WHERE id = $1`,
          [id],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      await markDirty();
      return reply.code(201).send({ status: 'recorded' });
    },
  );

  app.post(
    '/v1/moderation/perspectives/:id/remove',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reasonCode'],
          properties: { reasonCode: { type: 'string', enum: [...REASON_CODES.perspective] } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { reasonCode } = req.body as { reasonCode: string };
      const { rows } = await pool.query<{ author_id: string | null }>(
        "SELECT author_id FROM citation_perspectives WHERE id = $1 AND status = 'visible'",
        [id],
      );
      if (!rows[0]) return notFound(reply);
      if (rows[0].author_id === req.session!.accountId)
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      await pool.query(
        "UPDATE citation_perspectives SET status = 'removed', removed_reason = $2 WHERE id = $1",
        [id, reasonCode],
      );
      await logAction(pool, {
        action: 'perspective.removed',
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      await markDirty();
      return { status: 'removed' };
    },
  );

  /** Takes down an accepted citation (counts against its submitter's score). */
  app.post(
    '/v1/moderation/citations/:id/remove',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reasonCode'],
          properties: { reasonCode: { type: 'string', enum: [...REASON_CODES.citation.reject] } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { reasonCode } = req.body as { reasonCode: string };
      const { rows } = await pool.query<{ submitted_by: string | null }>(
        "SELECT submitted_by FROM citations WHERE id = $1 AND status = 'accepted'",
        [id],
      );
      if (!rows[0]) return notFound(reply);
      if (rows[0].submitted_by === req.session!.accountId)
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      await pool.query("UPDATE citations SET status = 'removed' WHERE id = $1", [id]);
      await logAction(pool, {
        action: 'citation.removed',
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      await markDirty();
      return { status: 'removed' };
    },
  );

  /** Your own contribution score (private to you). */
  app.get('/v1/me/contribution-score', { preHandler: member }, async (req) => {
    const { rows } = await pool.query(
      `SELECT round(score, 2)::float AS score, citations, perspectives, takedowns, noted,
              computed_at AS "computedAt"
         FROM contribution_scores WHERE account_id = $1`,
      [req.session!.accountId],
    );
    return {
      score: rows[0] ?? null,
      revokeBelow: CONTRIBUTION_V1.revokeBelow,
      formula:
        'Accepted citations (0.8 × accuracy + 0.2 × approval, each a cautious Wilson estimate) + helpful perspectives − 3 per takedown − 1 per citation that needed a context note. Recomputed every few minutes. Draft, under review.',
    };
  });
}
