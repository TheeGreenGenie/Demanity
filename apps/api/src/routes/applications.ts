import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';

/**
 * Contributor applications (R13) and leader page claims (R17).
 *
 * - Members apply to contribute in a category with a short essay; moderators
 *   approve (a 1-year grant) or reject with a published reason code.
 * - A leader claims their page with private evidence moderators can check
 *   (e.g. an official .gov email). Approval links the account to the leader:
 *   they can then respond to requests and post as themselves, and they can
 *   never cite themselves or edit their trust page.
 * - Nobody decides their own case; every decision is publicly logged.
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const uuid = { type: 'string', format: 'uuid' } as const;
const idParam = { type: 'object', properties: { id: uuid } } as const;
const slugParam = {
  type: 'object',
  properties: { slug: { type: 'string', pattern: '^[a-z0-9-]{2,80}$' } },
} as const;

export async function applicationRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; limits: RouteLimits },
) {
  const { pool, limits } = deps;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const moderatorOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await isModerator(pool, req.session!.accountId)))
      return reply.code(403).send({ error: 'moderator_only' });
  };

  // --- Contributor applications ----------------------------------------------------

  app.post(
    '/v1/contributor-applications',
    {
      preHandler: member,
      config: { rateLimit: limits.request },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'essay'],
          properties: {
            category: { type: 'string', pattern: '^[a-z0-9-]{2,60}$' },
            essay: { type: 'string', minLength: 300, maxLength: 6000 },
          },
        },
      },
    },
    async (req, reply) => {
      const me = req.session!.accountId;
      const { category, essay } = req.body as { category: string; essay: string };
      const { rows: cat } = await pool.query<{ id: string }>(
        "SELECT id FROM communities WHERE slug = $1 AND kind = 'topic'",
        [category],
      );
      if (!cat[0]) return reply.code(400).send({ error: 'unknown_category' });
      const { rowCount: active } = await pool.query(
        "SELECT 1 FROM contributor_grants WHERE account_id = $1 AND category_id = $2 AND expires_at > now() + interval '30 days'",
        [me, cat[0].id],
      );
      if (active) return reply.code(409).send({ error: 'already_contributor' });
      try {
        const { rows } = await pool.query<{ id: string }>(
          'INSERT INTO contributor_applications (account_id, category_id, essay) VALUES ($1, $2, $3) RETURNING id',
          [me, cat[0].id, essay.trim()],
        );
        return reply.code(201).send({ id: rows[0]!.id, status: 'pending' });
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          return reply.code(409).send({ error: 'application_pending' });
        throw err;
      }
    },
  );

  /** Your own contributor status: grants (with expiry) and applications. */
  app.get('/v1/me/contributor', { preHandler: member }, async (req) => {
    const me = req.session!.accountId;
    const [grants, apps] = await Promise.all([
      pool.query(
        `SELECT c.slug AS category, c.name AS "categoryName", g.expires_at AS "expiresAt"
           FROM contributor_grants g JOIN communities c ON c.id = g.category_id
          WHERE g.account_id = $1 AND g.expires_at > now() ORDER BY c.name`,
        [me],
      ),
      pool.query(
        `SELECT a.id, c.slug AS category, c.name AS "categoryName", a.status,
                a.reason_code AS "reasonCode", a.created_at AS "createdAt"
           FROM contributor_applications a JOIN communities c ON c.id = a.category_id
          WHERE a.account_id = $1 ORDER BY a.created_at DESC LIMIT 50`,
        [me],
      ),
    ]);
    return { grants: grants.rows, applications: apps.rows };
  });

  app.get(
    '/v1/moderation/contributor-applications',
    { preHandler: [member, moderatorOnly] },
    async () => {
      // The applicant's username is not shown to reviewers: judge the essay, not the person.
      const { rows } = await pool.query(
        `SELECT a.id, c.slug AS category, c.name AS "categoryName", a.essay, a.created_at AS "createdAt"
           FROM contributor_applications a JOIN communities c ON c.id = a.category_id
          WHERE a.status = 'pending' ORDER BY a.created_at LIMIT 100`,
      );
      return { applications: rows };
    },
  );

  app.post(
    '/v1/moderation/contributor-applications/:id/decision',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['decision', 'reasonCode'],
          properties: {
            decision: { type: 'string', enum: ['approve', 'reject'] },
            reasonCode: {
              type: 'string',
              enum: [
                ...REASON_CODES.contributorApplication.approve,
                ...REASON_CODES.contributorApplication.reject,
              ],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const { decision, reasonCode } = req.body as {
        decision: 'approve' | 'reject';
        reasonCode: string;
      };
      if (
        !(REASON_CODES.contributorApplication[decision] as readonly string[]).includes(reasonCode)
      )
        return reply.code(400).send({ error: 'reason_does_not_match_decision' });
      const { rows } = await pool.query<{ account_id: string; category_id: string }>(
        "SELECT account_id, category_id FROM contributor_applications WHERE id = $1 AND status = 'pending'",
        [id],
      );
      const a = rows[0];
      if (!a) return notFound(reply);
      if (a.account_id === req.session!.accountId)
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      await pool.query(
        `UPDATE contributor_applications SET status = $2, reason_code = $3, decided_at = now() WHERE id = $1`,
        [id, decision === 'approve' ? 'approved' : 'rejected', reasonCode],
      );
      if (decision === 'approve')
        await pool.query(
          `INSERT INTO contributor_grants (account_id, category_id, expires_at)
           VALUES ($1, $2, now() + interval '1 year')
           ON CONFLICT (account_id, category_id)
             DO UPDATE SET expires_at = EXCLUDED.expires_at, granted_at = now()`,
          [a.account_id, a.category_id],
        );
      await logAction(pool, {
        action: `contributor_application.${decision === 'approve' ? 'approved' : 'rejected'}`,
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      return { status: decision === 'approve' ? 'approved' : 'rejected' };
    },
  );

  // --- Leader page claims -----------------------------------------------------------------

  async function leaderBySlug(slug: string) {
    const { rows } = await pool.query<{
      id: string;
      account_id: string | null;
      in_office: boolean;
    }>('SELECT id, account_id, in_office FROM leaders WHERE slug = $1', [slug]);
    return rows[0] ?? null;
  }

  /** Viewer-specific leader state (kept off the cached leader page). */
  app.get('/v1/leaders/:slug/viewer', { schema: { params: slugParam } }, async (req, reply) => {
    const l = await leaderBySlug((req.params as { slug: string }).slug);
    if (!l) return notFound(reply);
    const me = req.session?.accountId ?? null;
    if (!me) return { isLeader: false, claimPending: false, claimed: l.account_id !== null };
    const { rowCount } = await pool.query(
      "SELECT 1 FROM leader_claims WHERE leader_id = $1 AND account_id = $2 AND status = 'pending'",
      [l.id, me],
    );
    return {
      isLeader: l.account_id === me,
      claimPending: (rowCount ?? 0) > 0,
      claimed: l.account_id !== null,
    };
  });

  app.post(
    '/v1/leaders/:slug/claims',
    {
      preHandler: member,
      config: { rateLimit: limits.request },
      schema: {
        params: slugParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['evidence'],
          properties: { evidence: { type: 'string', minLength: 20, maxLength: 2000 } },
        },
      },
    },
    async (req, reply) => {
      const me = req.session!.accountId;
      const l = await leaderBySlug((req.params as { slug: string }).slug);
      if (!l) return notFound(reply);
      if (l.account_id) return reply.code(409).send({ error: 'already_claimed' });
      if (!l.in_office) return reply.code(409).send({ error: 'leader_not_in_office' });
      const { rowCount: isLeader } = await pool.query(
        'SELECT 1 FROM leaders WHERE account_id = $1',
        [me],
      );
      if (isLeader) return reply.code(409).send({ error: 'already_a_leader' });
      try {
        const { rows } = await pool.query<{ id: string }>(
          'INSERT INTO leader_claims (account_id, leader_id, evidence) VALUES ($1, $2, $3) RETURNING id',
          [me, l.id, (req.body as { evidence: string }).evidence.trim()],
        );
        return reply.code(201).send({ id: rows[0]!.id, status: 'pending' });
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          return reply.code(409).send({ error: 'claim_pending' });
        throw err;
      }
    },
  );

  app.get('/v1/moderation/leader-claims', { preHandler: [member, moderatorOnly] }, async () => {
    const { rows } = await pool.query(
      `SELECT c.id, l.slug AS "leaderSlug", l.name AS "leaderName", l.office, a.username,
              c.evidence, c.created_at AS "createdAt"
         FROM leader_claims c JOIN leaders l ON l.id = c.leader_id JOIN accounts a ON a.id = c.account_id
        WHERE c.status = 'pending' ORDER BY c.created_at LIMIT 100`,
    );
    return { claims: rows };
  });

  app.post(
    '/v1/moderation/leader-claims/:id/decision',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['decision', 'reasonCode'],
          properties: {
            decision: { type: 'string', enum: ['approve', 'reject'] },
            reasonCode: {
              type: 'string',
              enum: [...REASON_CODES.leaderClaim.approve, ...REASON_CODES.leaderClaim.reject],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const { decision, reasonCode } = req.body as {
        decision: 'approve' | 'reject';
        reasonCode: string;
      };
      if (!(REASON_CODES.leaderClaim[decision] as readonly string[]).includes(reasonCode))
        return reply.code(400).send({ error: 'reason_does_not_match_decision' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ account_id: string; leader_id: string }>(
          "SELECT account_id, leader_id FROM leader_claims WHERE id = $1 AND status = 'pending' FOR UPDATE",
          [id],
        );
        const c = rows[0];
        if (!c) {
          await client.query('ROLLBACK');
          return notFound(reply);
        }
        if (c.account_id === req.session!.accountId) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'cannot_decide_own_case' });
        }
        if (decision === 'approve') {
          const { rowCount } = await client.query(
            'UPDATE leaders SET account_id = $2 WHERE id = $1 AND account_id IS NULL',
            [c.leader_id, c.account_id],
          );
          if (!rowCount) {
            await client.query('ROLLBACK');
            return reply.code(409).send({ error: 'already_claimed' });
          }
        }
        await client.query(
          'UPDATE leader_claims SET status = $2, reason_code = $3, decided_at = now() WHERE id = $1',
          [id, decision === 'approve' ? 'approved' : 'rejected', reasonCode],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      await logAction(pool, {
        action: `leader_claim.${decision === 'approve' ? 'approved' : 'rejected'}`,
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      // The cached leader page shows "claimed"; refresh it in the next batch.
      await pool.query('UPDATE data_version SET dirty = true');
      return { status: decision === 'approve' ? 'approved' : 'rejected' };
    },
  );
}
