import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import type { ResponseCache } from '../cache.js';
import { OFFICE_LEVEL } from '../civic/rollups.js';
import { matchSource, wilsonLowerBound } from '../civic/trust.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';

/**
 * Citations and trust scoring inputs (R12, R17, R33; docs/SCORING.md §2-§3).
 *
 * - Who may submit: contributors granted the category (yearly), moderators,
 *   and leaders who have claimed their page (citing OTHER leaders only; their
 *   citations always carry their name). Contributors stay unattributed.
 * - Every source URL must match the approved list (docs/SOURCES.md).
 * - Moderators accept or reject; nobody decides their own submission.
 * - Members vote "Accurate?" (scored) and "Approve?" (shown) once each. Only
 *   anonymous totals are stored, never which way an account voted.
 * - Accepting citations and voting mark scores dirty; the server recomputes
 *   all scores in a batch every few minutes (ADR 0007), not per request.
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const uuid = { type: 'string', format: 'uuid' } as const;
const slugParam = {
  type: 'object',
  properties: { slug: { type: 'string', pattern: '^[a-z0-9-]{2,80}$' } },
} as const;
const idParam = { type: 'object', properties: { id: uuid } } as const;
const viewer = (req: FastifyRequest) => req.session?.accountId ?? null;

export async function citationRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; limits: RouteLimits; cache: ResponseCache },
) {
  const { pool, limits, cache } = deps;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const markDirty = () => pool.query('UPDATE data_version SET dirty = true');

  const moderatorOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await isModerator(pool, req.session!.accountId)))
      return reply.code(403).send({ error: 'moderator_only' });
  };

  app.get('/v1/sources', async (req, reply) =>
    cache.serve(req, reply, 'sources', async () => {
      const { rows } = await pool.query(
        'SELECT domain, name, tier, weight::float AS weight FROM approved_sources ORDER BY tier, name',
      );
      return {
        sources: rows,
        note: 'A URL is accepted when its host is one of these domains or a subdomain of one. Draft list, under review.',
      };
    }),
  );

  // --- Submitting -------------------------------------------------------------

  app.post(
    '/v1/leaders/:slug/citations',
    {
      preHandler: member,
      config: { rateLimit: limits.request },
      schema: {
        params: slugParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'direction', 'claim', 'sourceUrl', 'actionDate'],
          properties: {
            category: { type: 'string', pattern: '^[a-z0-9-]{2,60}$' },
            direction: { type: 'string', enum: ['positive', 'negative'] },
            claim: { type: 'string', minLength: 10, maxLength: 1000 },
            sourceUrl: { type: 'string', minLength: 10, maxLength: 2000 },
            actionDate: { type: 'string', format: 'date' },
          },
        },
      },
    },
    async (req, reply) => {
      const me = req.session!.accountId;
      const body = req.body as {
        category: string;
        direction: string;
        claim: string;
        sourceUrl: string;
        actionDate: string;
      };
      const { rows: target } = await pool.query<{ id: string; office_kind: string }>(
        'SELECT id, office_kind FROM leaders WHERE slug = $1',
        [(req.params as { slug: string }).slug],
      );
      const leader = target[0];
      if (!leader) return notFound(reply);
      const { rows: cats } = await pool.query<{ id: string; applies: boolean }>(
        `SELECT c.id, EXISTS (SELECT 1 FROM category_levels cl WHERE cl.category_id = c.id AND cl.level = $2) AS applies
           FROM communities c WHERE c.slug = $1 AND c.kind = 'topic'`,
        [body.category, OFFICE_LEVEL[leader.office_kind] ?? 'federal'],
      );
      const cat = cats[0];
      if (!cat) return reply.code(400).send({ error: 'unknown_category' });
      if (!cat.applies) return reply.code(400).send({ error: 'category_not_applicable' });
      if (new Date(`${body.actionDate}T00:00:00Z`).getTime() > Date.now())
        return reply.code(400).send({ error: 'action_date_in_future' });

      // Who is submitting?
      const { rows: mine } = await pool.query<{ id: string }>(
        'SELECT id FROM leaders WHERE account_id = $1',
        [me],
      );
      const authorLeader = mine[0]?.id ?? null;
      if (authorLeader === leader.id) return reply.code(403).send({ error: 'self_citation' });
      if (!authorLeader && !(await isModerator(pool, me))) {
        const { rowCount } = await pool.query(
          'SELECT 1 FROM contributor_grants WHERE account_id = $1 AND category_id = $2 AND expires_at > now()',
          [me, cat.id],
        );
        if (!rowCount) return reply.code(403).send({ error: 'contributors_only' });
      }

      const { rows: domains } = await pool.query<{ domain: string }>(
        'SELECT domain FROM approved_sources',
      );
      const domain = matchSource(
        body.sourceUrl,
        domains.map((d) => d.domain),
      );
      if (!domain) return reply.code(422).send({ error: 'source_not_approved' });

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO citations (leader_id, category_id, direction, claim, source_url, source_domain,
                                action_date, submitted_by, author_leader_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          leader.id,
          cat.id,
          body.direction,
          body.claim.trim(),
          body.sourceUrl,
          domain,
          body.actionDate,
          me,
          authorLeader,
        ],
      );
      return reply.code(201).send({ id: rows[0]!.id, status: 'pending' });
    },
  );

  // --- Reading (viewer-specific: your own vote markers) ---------------------------

  app.get(
    '/v1/leaders/:slug/citations',
    {
      schema: {
        params: slugParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { category: { type: 'string', pattern: '^[a-z0-9-]{2,60}$' } },
        },
      },
    },
    async (req, reply) => {
      const { rows: l } = await pool.query<{ id: string }>(
        'SELECT id FROM leaders WHERE slug = $1',
        [(req.params as { slug: string }).slug],
      );
      if (!l[0]) return notFound(reply);
      const { category } = req.query as { category?: string };
      const { rows } = await pool.query<{
        accurate_yes: number;
        accurate_no: number;
        action_date: Date;
        author_name: string | null;
      }>(
        `SELECT c.id, cat.slug AS "categorySlug", cat.name AS "categoryName", c.direction, c.claim,
                c.source_url AS "sourceUrl", s.name AS "sourceName", c.action_date,
                c.accurate_yes, c.accurate_no, c.approve_yes AS "approveYes", c.approve_no AS "approveNo",
                al.name AS author_name,
                EXISTS (SELECT 1 FROM citation_vote_markers m WHERE m.citation_id = c.id AND m.account_id = $3 AND m.kind = 'accurate') AS "votedAccurate",
                EXISTS (SELECT 1 FROM citation_vote_markers m WHERE m.citation_id = c.id AND m.account_id = $3 AND m.kind = 'approve') AS "votedApprove"
           FROM citations c
           JOIN communities cat ON cat.id = c.category_id
           JOIN approved_sources s ON s.domain = c.source_domain
           LEFT JOIN leaders al ON al.id = c.author_leader_id
          WHERE c.leader_id = $1 AND c.status = 'accepted' AND ($2::text IS NULL OR cat.slug = $2)
          ORDER BY c.action_date DESC LIMIT 200`,
        [l[0].id, category ?? null, viewer(req)],
      );
      return {
        citations: rows.map(({ accurate_yes, accurate_no, action_date, author_name, ...c }) => ({
          ...c,
          actionDate: action_date.toISOString().slice(0, 10),
          // Leaders' citations always carry their name; contributors' never do (R17).
          attribution: author_name ? `Cited by ${author_name}` : 'Contributor',
          accurateYes: accurate_yes,
          accurateNo: accurate_no,
          strength:
            Math.round(wilsonLowerBound(accurate_yes, accurate_yes + accurate_no) * 1000) / 1000,
        })),
      };
    },
  );

  // --- Voting: one "Accurate?" and one "Approve?" per member, private ------------------

  app.post(
    '/v1/citations/:id/votes',
    {
      preHandler: member,
      config: { rateLimit: limits.stance },
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'value'],
          properties: {
            kind: { type: 'string', enum: ['accurate', 'approve'] },
            value: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const { kind, value } = req.body as { kind: 'accurate' | 'approve'; value: boolean };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount: exists } = await client.query(
          "SELECT 1 FROM citations WHERE id = $1 AND status = 'accepted'",
          [id],
        );
        if (!exists) {
          await client.query('ROLLBACK');
          return notFound(reply);
        }
        const { rowCount } = await client.query(
          'INSERT INTO citation_vote_markers (account_id, citation_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [req.session!.accountId, id, kind],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'already_voted' });
        }
        // Column names come from fixed enums above, never from user text.
        const column = `${kind}_${value ? 'yes' : 'no'}`;
        const { rows } = await client.query(
          `UPDATE citations SET ${column} = ${column} + 1 WHERE id = $1
           RETURNING accurate_yes AS "accurateYes", accurate_no AS "accurateNo",
                     approve_yes AS "approveYes", approve_no AS "approveNo"`,
          [id],
        );
        if (kind === 'accurate') await client.query('UPDATE data_version SET dirty = true');
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // --- Moderation -------------------------------------------------------------------

  app.get('/v1/moderation/citations', { preHandler: [member, moderatorOnly] }, async () => {
    const { rows } = await pool.query(
      `SELECT c.id, l.slug AS "leaderSlug", l.name AS "leaderName", cat.slug AS "categorySlug",
                c.direction, c.claim, c.source_url AS "sourceUrl", c.source_domain AS "sourceDomain",
                c.action_date AS "actionDate", c.created_at AS "createdAt",
                (c.author_leader_id IS NOT NULL) AS "byLeader"
           FROM citations c JOIN leaders l ON l.id = c.leader_id JOIN communities cat ON cat.id = c.category_id
          WHERE c.status = 'pending' ORDER BY c.created_at LIMIT 100`,
    );
    return { citations: rows };
  });

  app.post(
    '/v1/moderation/citations/:id/decision',
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
              enum: [...REASON_CODES.citation.accept, ...REASON_CODES.citation.reject],
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
      const allowed = REASON_CODES.citation[decision] as readonly string[];
      if (!allowed.includes(reasonCode))
        return reply.code(400).send({ error: 'reason_does_not_match_decision' });
      const { rows } = await pool.query<{
        submitted_by: string | null;
        leader_id: string;
        category_id: string;
      }>(
        "SELECT submitted_by, leader_id, category_id FROM citations WHERE id = $1 AND status = 'pending'",
        [id],
      );
      const c = rows[0];
      if (!c) return notFound(reply);
      if (c.submitted_by === req.session!.accountId)
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      if (decision === 'accept') {
        // t = the leader's current score in this category (docs/SCORING.md §3), 0.5 if none.
        await pool.query(
          `UPDATE citations SET status = 'accepted', accepted_at = now(),
                  trust_at_add = COALESCE((SELECT score / 100.0 FROM category_scores
                                            WHERE subject_type = 'leader' AND subject_id = $2
                                              AND category_id = $3 AND NOT is_sample), 0.5)
            WHERE id = $1`,
          [id, c.leader_id, c.category_id],
        );
        await markDirty();
      } else {
        await pool.query("UPDATE citations SET status = 'rejected' WHERE id = $1", [id]);
      }
      await logAction(pool, {
        action: `citation.${decision}ed`,
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      return { status: decision === 'accept' ? 'accepted' : 'rejected' };
    },
  );

  // Contributor grants: moderators approve a contributor's essay for a category.
  const grantBody = {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'category', 'reasonCode'],
    properties: {
      username: { type: 'string', maxLength: 30 },
      category: { type: 'string', pattern: '^[a-z0-9-]{2,60}$' },
      reasonCode: { type: 'string', enum: [...REASON_CODES.contributor] },
    },
  } as const;

  app.put(
    '/v1/moderation/contributors',
    { preHandler: [member, moderatorOnly], schema: { body: grantBody } },
    async (req, reply) => {
      const { username, category, reasonCode } = req.body as {
        username: string;
        category: string;
        reasonCode: string;
      };
      if (reasonCode !== 'essay_approved')
        return reply.code(400).send({ error: 'reason_does_not_match_decision' });
      const { rowCount } = await pool.query(
        `INSERT INTO contributor_grants (account_id, category_id, expires_at)
         SELECT a.id, c.id, now() + interval '1 year' FROM accounts a, communities c
          WHERE a.username = $1 AND a.status = 'active' AND c.slug = $2 AND c.kind = 'topic'
            AND a.id <> $3
         ON CONFLICT (account_id, category_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, granted_at = now()`,
        [username, category, req.session!.accountId],
      );
      if (!rowCount) return notFound(reply);
      await logAction(pool, {
        action: 'contributor.granted',
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      return reply.code(204).send();
    },
  );

  app.delete(
    '/v1/moderation/contributors',
    { preHandler: [member, moderatorOnly], schema: { body: grantBody } },
    async (req, reply) => {
      const { username, category, reasonCode } = req.body as {
        username: string;
        category: string;
        reasonCode: string;
      };
      if (reasonCode === 'essay_approved')
        return reply.code(400).send({ error: 'reason_does_not_match_decision' });
      await pool.query(
        `DELETE FROM contributor_grants g USING accounts a, communities c
          WHERE g.account_id = a.id AND g.category_id = c.id AND a.username = $1 AND c.slug = $2`,
        [username, category],
      );
      await logAction(pool, {
        action: 'contributor.revoked',
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      return reply.code(204).send();
    },
  );
}
