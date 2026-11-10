import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { matchSource } from '../civic/trust.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';

/**
 * Content moderation (R10, R29, R33; docs/MODERATION.md):
 * - Context notes instead of removal: labeled, cite an approved source.
 * - Comment removal (posts already have it), clear policy violations only.
 * - Appeals by the affected author, decided by a DIFFERENT moderator than the
 *   one who acted. Upheld appeals restore content or withdraw the note.
 * Every action cites a published reason code and is publicly logged.
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const uuid = { type: 'string', format: 'uuid' } as const;
const idParam = { type: 'object', properties: { id: uuid } } as const;

export async function contentModerationRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; limits: RouteLimits },
) {
  const { pool, limits } = deps;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const moderatorOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await isModerator(pool, req.session!.accountId)))
      return reply.code(403).send({ error: 'moderator_only' });
  };

  // --- Comment removal ---------------------------------------------------------------

  app.post(
    '/v1/moderation/comments/:id/remove',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: idParam,
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
      const { rows } = await pool.query<{ author_id: string | null }>(
        "SELECT author_id FROM comments WHERE id = $1 AND status = 'visible'",
        [id],
      );
      if (!rows[0]) return notFound(reply);
      if (rows[0].author_id === req.session!.accountId)
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      await pool.query(
        "UPDATE comments SET status = 'removed', removed_reason = $2, removed_by = $3 WHERE id = $1",
        [id, reasonCode, req.session!.accountId],
      );
      await logAction(pool, {
        action: 'comment.removed',
        reasonCode,
        actorAccountId: req.session!.accountId,
      });
      return { status: 'removed' };
    },
  );

  // --- Context notes ---------------------------------------------------------------------

  const TARGET_SQL: Record<string, string> = {
    post: 'SELECT author_id FROM posts WHERE id = $1',
    comment: 'SELECT author_id FROM comments WHERE id = $1',
    bill: 'SELECT NULL::uuid AS author_id FROM bills WHERE id = $1',
    citation: 'SELECT submitted_by AS author_id FROM citations WHERE id = $1',
  };

  app.post(
    '/v1/moderation/context-notes',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['targetType', 'targetId', 'body', 'sourceUrl', 'reasonCode'],
          properties: {
            targetType: { type: 'string', enum: ['post', 'comment', 'bill', 'citation'] },
            targetId: uuid,
            body: { type: 'string', minLength: 10, maxLength: 1000 },
            sourceUrl: { type: 'string', minLength: 10, maxLength: 2000 },
            reasonCode: { type: 'string', enum: [...REASON_CODES.contextNote] },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body as {
        targetType: string;
        targetId: string;
        body: string;
        sourceUrl: string;
        reasonCode: string;
      };
      const { rows } = await pool.query<{ author_id: string | null }>(TARGET_SQL[b.targetType]!, [
        b.targetId,
      ]);
      if (!rows[0]) return notFound(reply);
      if (rows[0].author_id === req.session!.accountId)
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      const { rows: domains } = await pool.query<{ domain: string }>(
        'SELECT domain FROM approved_sources',
      );
      const domain = matchSource(
        b.sourceUrl,
        domains.map((d) => d.domain),
      );
      if (!domain) return reply.code(422).send({ error: 'source_not_approved' });
      const { rows: note } = await pool.query<{ id: string }>(
        `INSERT INTO context_notes (target_type, target_id, body, source_url, source_domain, author_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [b.targetType, b.targetId, b.body.trim(), b.sourceUrl, domain, req.session!.accountId],
      );
      await logAction(pool, {
        action: `context_note.added_to_${b.targetType}`,
        reasonCode: b.reasonCode,
        actorAccountId: req.session!.accountId,
      });
      return reply.code(201).send({ id: note[0]!.id });
    },
  );

  /** Public: visible notes on a piece of content (the moderator is never named). */
  app.get(
    '/v1/context-notes',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['targetType', 'targetId'],
          properties: {
            targetType: { type: 'string', enum: ['post', 'comment', 'bill', 'citation'] },
            targetId: uuid,
          },
        },
      },
    },
    async (req) => {
      const { targetType, targetId } = req.query as { targetType: string; targetId: string };
      const { rows } = await pool.query(
        `SELECT n.id, n.body, n.source_url AS "sourceUrl", s.name AS "sourceName", n.created_at AS "createdAt"
           FROM context_notes n JOIN approved_sources s ON s.domain = n.source_domain
          WHERE n.target_type = $1 AND n.target_id = $2 AND n.status = 'visible'
          ORDER BY n.created_at`,
        [targetType, targetId],
      );
      return { notes: rows };
    },
  );

  // --- Appeals -------------------------------------------------------------------------------

  /** Who the affected author is, and which moderator acted (internal). */
  async function appealTarget(type: string, id: string) {
    const sql: Record<string, string> = {
      post: "SELECT author_id, removed_by AS actor, status = 'removed' AS actionable FROM posts WHERE id = $1",
      comment:
        "SELECT author_id, removed_by AS actor, status = 'removed' AS actionable FROM comments WHERE id = $1",
      context_note: `SELECT CASE n.target_type
                              WHEN 'post' THEN (SELECT author_id FROM posts WHERE id = n.target_id)
                              WHEN 'comment' THEN (SELECT author_id FROM comments WHERE id = n.target_id)
                              WHEN 'citation' THEN (SELECT submitted_by FROM citations WHERE id = n.target_id)
                            END AS author_id,
                            n.author_id AS actor, n.status = 'visible' AS actionable
                       FROM context_notes n WHERE n.id = $1`,
    };
    const { rows } = await pool.query<{
      author_id: string | null;
      actor: string | null;
      actionable: boolean;
    }>(sql[type]!, [id]);
    return rows[0] ?? null;
  }

  app.post(
    '/v1/appeals',
    {
      preHandler: member,
      config: { rateLimit: limits.request },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['targetType', 'targetId', 'statement'],
          properties: {
            targetType: { type: 'string', enum: ['post', 'comment', 'context_note'] },
            targetId: uuid,
            statement: { type: 'string', minLength: 20, maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      const { targetType, targetId, statement } = req.body as {
        targetType: string;
        targetId: string;
        statement: string;
      };
      const t = await appealTarget(targetType, targetId);
      if (!t) return notFound(reply);
      if (t.author_id !== req.session!.accountId)
        return reply.code(403).send({ error: 'only_the_author_can_appeal' });
      if (!t.actionable) return reply.code(409).send({ error: 'nothing_to_appeal' });
      try {
        const { rows } = await pool.query<{ id: string }>(
          'INSERT INTO appeals (account_id, target_type, target_id, statement) VALUES ($1, $2, $3, $4) RETURNING id',
          [req.session!.accountId, targetType, targetId, statement.trim()],
        );
        return reply.code(201).send({ id: rows[0]!.id, status: 'pending' });
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          return reply.code(409).send({ error: 'already_appealed' });
        throw err;
      }
    },
  );

  app.get('/v1/me/appeals', { preHandler: member }, async (req) => {
    const { rows } = await pool.query(
      `SELECT id, target_type AS "targetType", target_id AS "targetId", status, reason_code AS "reasonCode",
              created_at AS "createdAt"
         FROM appeals WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.session!.accountId],
    );
    return { appeals: rows };
  });

  app.get('/v1/moderation/appeals', { preHandler: [member, moderatorOnly] }, async (req) => {
    const { rows } = await pool.query<{ target_type: string; target_id: string }>(
      `SELECT id, target_type, target_id, statement, created_at AS "createdAt"
         FROM appeals WHERE status = 'pending' ORDER BY created_at LIMIT 100`,
    );
    const out = [];
    for (const r of rows) {
      const t = await appealTarget(r.target_type, r.target_id);
      out.push({
        id: (r as unknown as { id: string }).id,
        targetType: r.target_type,
        targetId: r.target_id,
        statement: (r as unknown as { statement: string }).statement,
        // You can't review an appeal against your own decision.
        yourDecision: t?.actor === req.session!.accountId,
      });
    }
    return { appeals: out };
  });

  app.post(
    '/v1/moderation/appeals/:id/decision',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['decision', 'reasonCode'],
          properties: {
            decision: { type: 'string', enum: ['uphold', 'deny'] },
            reasonCode: {
              type: 'string',
              enum: [...REASON_CODES.appeal.uphold, ...REASON_CODES.appeal.deny],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { decision, reasonCode } = req.body as {
        decision: 'uphold' | 'deny';
        reasonCode: string;
      };
      if (!(REASON_CODES.appeal[decision] as readonly string[]).includes(reasonCode))
        return reply.code(400).send({ error: 'reason_does_not_match_decision' });
      const { rows } = await pool.query<{
        target_type: string;
        target_id: string;
        account_id: string;
      }>(
        "SELECT target_type, target_id, account_id FROM appeals WHERE id = $1 AND status = 'pending'",
        [id],
      );
      const a = rows[0];
      if (!a) return notFound(reply);
      const t = await appealTarget(a.target_type, a.target_id);
      const me = req.session!.accountId;
      if (t?.actor === me || a.account_id === me)
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      if (decision === 'uphold') {
        if (a.target_type === 'post')
          await pool.query(
            "UPDATE posts SET status = 'visible', removed_reason = NULL, removed_by = NULL WHERE id = $1",
            [a.target_id],
          );
        else if (a.target_type === 'comment')
          await pool.query(
            "UPDATE comments SET status = 'visible', removed_reason = NULL, removed_by = NULL WHERE id = $1",
            [a.target_id],
          );
        else
          await pool.query("UPDATE context_notes SET status = 'withdrawn' WHERE id = $1", [
            a.target_id,
          ]);
      }
      await pool.query(
        'UPDATE appeals SET status = $2, reason_code = $3, decided_at = now() WHERE id = $1',
        [id, decision === 'uphold' ? 'upheld' : 'denied', reasonCode],
      );
      await logAction(pool, {
        action: `appeal.${decision === 'uphold' ? 'upheld' : 'denied'}`,
        reasonCode,
        actorAccountId: me,
      });
      return { status: decision === 'uphold' ? 'upheld' : 'denied' };
    },
  );
}
