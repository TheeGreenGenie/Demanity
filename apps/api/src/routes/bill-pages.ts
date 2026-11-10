import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import type { ResponseCache } from '../cache.js';
import { matchSource } from '../civic/trust.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';
import { queries } from '../social/queries.js';

/**
 * Bill pages and member contributions (R23, R24):
 * - timeline of official actions;
 * - a discussion per bill (posts linked to the bill, placed in its topic or
 *   state community);
 * - executive orders (Federal Register);
 * - contributions: missing items (must cite an approved source) and bill
 *   ideas, public only after moderator approval; bill ideas take upvotes.
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const uuid = { type: 'string', format: 'uuid' } as const;
const idParam = { type: 'object', properties: { id: uuid } } as const;
const viewer = (req: FastifyRequest) => req.session?.accountId ?? null;

export async function billPageRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; limits: RouteLimits; cache: ResponseCache },
) {
  const { pool, limits, cache } = deps;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const moderatorOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await isModerator(pool, req.session!.accountId)))
      return reply.code(403).send({ error: 'moderator_only' });
  };

  // --- Timeline (cached: same for everyone) ------------------------------------------

  app.get('/v1/bills/:id/timeline', { schema: { params: idParam } }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    return cache.serve(req, reply, `bill-timeline:${id}`, async () => {
      const { rowCount } = await pool.query('SELECT 1 FROM bills WHERE id = $1', [id]);
      if (!rowCount) return null;
      const { rows } = await pool.query<{ action_date: Date }>(
        'SELECT action_date, text, type FROM bill_actions WHERE bill_id = $1 ORDER BY seq LIMIT 50',
        [id],
      );
      return {
        actions: rows.map(({ action_date, ...a }) => ({
          ...a,
          date: action_date.toISOString().slice(0, 10),
        })),
      };
    });
  });

  // --- Discussion -------------------------------------------------------------------------

  app.get(
    '/v1/bills/:id/posts',
    {
      schema: {
        params: idParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { cursor: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (req) =>
      queries.billPosts(
        pool,
        viewer(req),
        (req.params as { id: string }).id,
        (req.query as { cursor?: string }).cursor,
      ),
  );

  app.post(
    '/v1/bills/:id/posts',
    {
      preHandler: member,
      config: { rateLimit: limits.post },
      schema: {
        params: idParam,
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
      const id = (req.params as { id: string }).id;
      const { title, body } = req.body as { title: string; body: string };
      // Topic community first; else the state's community; else federal government.
      const { rows } = await pool.query<{ community_id: string | null }>(
        `SELECT COALESCE(b.category_id, p.community_id,
                         (SELECT id FROM communities WHERE slug = 'government-operations-and-politics')) AS community_id
           FROM bills b JOIN places p ON p.id = b.place_id WHERE b.id = $1`,
        [id],
      );
      if (!rows[0]?.community_id) return notFound(reply);
      const { rows: post } = await pool.query<{ id: string }>(
        'INSERT INTO posts (community_id, author_id, title, body, bill_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [rows[0].community_id, req.session!.accountId, title.trim(), body.trim(), id],
      );
      return reply.code(201).send(await queries.post(pool, req.session!.accountId, post[0]!.id));
    },
  );

  // --- Executive orders (cached) ----------------------------------------------------------

  app.get('/v1/executive-orders', async (req, reply) =>
    cache.serve(req, reply, 'executive-orders', async () => {
      const { rows } = await pool.query<{ signing_date: Date | null; publication_date: Date }>(
        `SELECT document_number AS "documentNumber", eo_number AS "number", title, signing_date,
                publication_date, president, abstract, url
           FROM executive_orders ORDER BY signing_date DESC NULLS LAST, publication_date DESC LIMIT 30`,
      );
      return {
        orders: rows.map(({ signing_date, publication_date, ...o }) => ({
          ...o,
          signingDate: signing_date?.toISOString().slice(0, 10) ?? null,
          publicationDate: publication_date.toISOString().slice(0, 10),
          sourceName: 'Federal Register',
        })),
      };
    }),
  );

  // --- Contributions (R24) ------------------------------------------------------------------

  app.post(
    '/v1/contributions',
    {
      preHandler: member,
      config: { rateLimit: limits.request },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'title', 'body'],
          properties: {
            kind: { type: 'string', enum: ['missing_item', 'bill_idea'] },
            title: { type: 'string', minLength: 5, maxLength: 200 },
            body: { type: 'string', minLength: 20, maxLength: 4000 },
            sourceUrl: { type: 'string', minLength: 10, maxLength: 2000 },
            place: { type: 'string', pattern: '^[a-z0-9-]{2,80}$' },
            category: { type: 'string', pattern: '^[a-z0-9-]{2,60}$' },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body as {
        kind: 'missing_item' | 'bill_idea';
        title: string;
        body: string;
        sourceUrl?: string;
        place?: string;
        category?: string;
      };
      if (b.kind === 'missing_item') {
        if (!b.sourceUrl) return reply.code(400).send({ error: 'source_required' });
        const { rows } = await pool.query<{ domain: string }>(
          'SELECT domain FROM approved_sources',
        );
        if (
          !matchSource(
            b.sourceUrl,
            rows.map((r) => r.domain),
          )
        )
          return reply.code(422).send({ error: 'source_not_approved' });
      }
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO contributions (account_id, kind, title, body, source_url, place_id, category_id)
         VALUES ($1, $2, $3, $4, $5,
                 (SELECT id FROM places WHERE slug = $6),
                 (SELECT id FROM communities WHERE slug = $7 AND kind = 'topic'))
         RETURNING id`,
        [
          req.session!.accountId,
          b.kind,
          b.title.trim(),
          b.body.trim(),
          b.sourceUrl ?? null,
          b.place ?? null,
          b.category ?? null,
        ],
      );
      return reply.code(201).send({ id: rows[0]!.id, status: 'pending' });
    },
  );

  /** Public: approved bill ideas (most supported first) or missing items. */
  app.get(
    '/v1/contributions',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { type: 'string', enum: ['missing_item', 'bill_idea'] } },
        },
      },
    },
    async (req) => {
      const { kind } = req.query as { kind: string };
      const { rows } = await pool.query(
        `SELECT c.id, c.title, c.body, c.source_url AS "sourceUrl", c.created_at AS "createdAt",
                a.username, p.name AS "placeName", cat.slug AS "categorySlug", cat.name AS "categoryName",
                (SELECT count(*)::int FROM contribution_votes v WHERE v.contribution_id = c.id) AS votes,
                EXISTS (SELECT 1 FROM contribution_votes v WHERE v.contribution_id = c.id AND v.account_id = $2) AS "myVote"
           FROM contributions c
           LEFT JOIN accounts a ON a.id = c.account_id
           LEFT JOIN places p ON p.id = c.place_id
           LEFT JOIN communities cat ON cat.id = c.category_id
          WHERE c.kind = $1 AND c.status = 'accepted'
          ORDER BY votes DESC, c.created_at DESC LIMIT 100`,
        [kind, viewer(req)],
      );
      return {
        contributions: rows.map(({ username, ...c }) => ({
          ...c,
          author: username ? { username } : null,
        })),
      };
    },
  );

  app.put(
    '/v1/contributions/:id/vote',
    { preHandler: member, schema: { params: idParam } },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const { rowCount } = await pool.query(
        "SELECT 1 FROM contributions WHERE id = $1 AND status = 'accepted' AND kind = 'bill_idea'",
        [id],
      );
      if (!rowCount) return notFound(reply);
      await pool.query(
        'INSERT INTO contribution_votes (account_id, contribution_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.session!.accountId, id],
      );
      return reply.code(204).send();
    },
  );

  app.delete(
    '/v1/contributions/:id/vote',
    { preHandler: member, schema: { params: idParam } },
    async (req, reply) => {
      await pool.query(
        'DELETE FROM contribution_votes WHERE account_id = $1 AND contribution_id = $2',
        [req.session!.accountId, (req.params as { id: string }).id],
      );
      return reply.code(204).send();
    },
  );

  app.get('/v1/moderation/contributions', { preHandler: [member, moderatorOnly] }, async () => {
    const { rows } = await pool.query(
      `SELECT c.id, c.kind, c.title, c.body, c.source_url AS "sourceUrl", c.created_at AS "createdAt"
           FROM contributions c WHERE c.status = 'pending' ORDER BY c.created_at LIMIT 100`,
    );
    return { contributions: rows };
  });

  app.post(
    '/v1/moderation/contributions/:id/decision',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['decision', 'reasonCode'],
          properties: {
            decision: { type: 'string', enum: ['accept', 'reject'] },
            reasonCode: {
              type: 'string',
              enum: [...REASON_CODES.contribution.accept, ...REASON_CODES.contribution.reject],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const { decision, reasonCode } = req.body as {
        decision: 'accept' | 'reject';
        reasonCode: string;
      };
      if (!(REASON_CODES.contribution[decision] as readonly string[]).includes(reasonCode))
        return reply.code(400).send({ error: 'reason_does_not_match_decision' });
      const { rows } = await pool.query<{ account_id: string | null }>(
        "SELECT account_id FROM contributions WHERE id = $1 AND status = 'pending'",
        [id],
      );
      if (!rows[0]) return notFound(reply);
      if (rows[0].account_id === req.session!.accountId)
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      await pool.query(
        'UPDATE contributions SET status = $2, reason_code = $3, decided_at = now() WHERE id = $1',
        [id, decision === 'accept' ? 'accepted' : 'rejected', reasonCode],
      );
      await logAction(pool, {
        action: `contribution.${decision === 'accept' ? 'accepted' : 'rejected'}`,
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      return { status: decision === 'accept' ? 'accepted' : 'rejected' };
    },
  );
}
