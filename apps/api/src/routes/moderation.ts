import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { createSession, type Session } from '../auth/sessions.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';
import { VaultClientError, type Vault } from '../vault-client.js';

/**
 * Moderation (R10, R26, R28):
 * - a public, append-only log (no moderator identities)
 * - review queue for verifications the provider could not decide
 * - permanent bans (propagated to the vault so the person cannot re-register)
 * - assisted recovery when both the passkey device and 2FA are lost
 */

export interface ModerationDeps {
  pool: Pool;
  vault: Vault;
  limits: RouteLimits;
}

const fullSession = requireSession({ scopes: ['full'], statuses: ['active'] });

function requireModerator(pool: Pool) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await fullSession(req, reply);
    if (reply.sent) return;
    if (!(await isModerator(pool, req.session!.accountId))) {
      return reply.code(403).send({ error: 'moderator_only' });
    }
  };
}

const decisionBody = (approve: readonly string[], deny: readonly string[]) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: ['decision', 'reasonCode'],
    properties: {
      decision: { type: 'string', enum: ['approve', 'deny'] },
      reasonCode: { type: 'string', enum: [...approve, ...deny] },
    },
  }) as const;

function reasonFits(
  decision: 'approve' | 'deny',
  reason: string,
  codes: { approve: readonly string[]; deny: readonly string[] },
) {
  return (decision === 'approve' ? codes.approve : codes.deny).includes(reason);
}

const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export async function moderationRoutes(app: FastifyInstance, deps: ModerationDeps) {
  const { pool, vault, limits } = deps;
  const moderator = requireModerator(pool);
  const actor = (req: FastifyRequest) => (req.session as Session).accountId;

  // --- Public log (guests may read) ------------------------------------------

  app.get(
    '/v1/moderation/log',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            before: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    async (req) => {
      const { before, limit } = req.query as { before?: number; limit: number };
      const { rows } = await pool.query(
        `SELECT id, action, target_username, reason_code, actor_role, created_at
           FROM moderation_log
          WHERE ($1::bigint IS NULL OR id < $1)
          ORDER BY id DESC
          LIMIT $2`,
        [before ?? null, limit],
      );
      return { entries: rows.map((r) => ({ ...r, id: Number(r.id) })) };
    },
  );

  app.get('/v1/moderation/reason-codes', async () => REASON_CODES);

  // --- Verification review queue ---------------------------------------------

  app.get('/v1/moderation/reviews', { preHandler: moderator }, async () => {
    const { rows } = await pool.query(
      `SELECT r.account_id, a.username, r.created_at
         FROM verification_reviews r JOIN accounts a ON a.id = r.account_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at`,
    );
    return { reviews: rows };
  });

  app.post(
    '/v1/moderation/reviews/:id/decision',
    {
      preHandler: moderator,
      schema: {
        params: uuidParam,
        body: decisionBody(REASON_CODES.verification.approve, REASON_CODES.verification.deny),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { decision, reasonCode } = req.body as {
        decision: 'approve' | 'deny';
        reasonCode: string;
      };
      if (!reasonFits(decision, reasonCode, REASON_CODES.verification)) {
        return reply.code(400).send({ error: 'reason_does_not_match_decision' });
      }
      if (id === actor(req)) return reply.code(403).send({ error: 'cannot_decide_own_case' });
      const { rowCount } = await pool.query(
        `UPDATE verification_reviews SET status = $2, reason_code = $3, decided_at = now()
          WHERE account_id = $1 AND status = 'pending'`,
        [id, decision === 'approve' ? 'approved' : 'denied', reasonCode],
      );
      if (!rowCount) return reply.code(404).send({ error: 'no_pending_review' });
      await logAction(pool, {
        action: `verification.${decision === 'approve' ? 'approved' : 'denied'}`,
        reasonCode,
        actorAccountId: actor(req),
      });
      return { status: decision === 'approve' ? 'approved' : 'denied' };
    },
  );

  // --- Bans --------------------------------------------------------------------

  app.post(
    '/v1/moderation/accounts/:username/ban',
    {
      preHandler: moderator,
      schema: {
        params: {
          type: 'object',
          required: ['username'],
          properties: { username: { type: 'string', pattern: '^[a-z0-9_]{3,30}$' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reasonCode'],
          properties: { reasonCode: { type: 'string', enum: [...REASON_CODES.ban] } },
        },
      },
    },
    async (req, reply) => {
      const { username } = req.params as { username: string };
      const { reasonCode } = req.body as { reasonCode: string };
      const { rows } = await pool.query<{ id: string; status: string }>(
        'SELECT id, status FROM accounts WHERE username = $1',
        [username],
      );
      const target = rows[0];
      if (!target) return reply.code(404).send({ error: 'unknown_account' });
      if (target.id === actor(req))
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      if (target.status === 'banned') return reply.code(409).send({ error: 'already_banned' });

      // Ban the identity first (so the person cannot re-register), then the account.
      if (target.status === 'verified' || target.status === 'active') {
        await vault.ban(target.id, reasonCode);
      }
      await pool.query("UPDATE accounts SET status = 'banned' WHERE id = $1", [target.id]);
      await pool.query('DELETE FROM sessions WHERE account_id = $1', [target.id]);
      await pool.query(
        'UPDATE passkeys SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL',
        [target.id],
      );
      await logAction(pool, {
        action: 'account.banned',
        reasonCode,
        actorAccountId: actor(req),
        targetUsername: username,
      });
      return { status: 'banned' };
    },
  );

  // --- Assisted recovery: device AND 2FA lost (R26) ---------------------------

  app.post(
    '/v1/auth/recovery/request',
    {
      config: { rateLimit: limits.codeSend },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username'],
          properties: { username: { type: 'string', maxLength: 30 } },
        },
      },
    },
    async (req, reply) => {
      const { username } = req.body as { username: string };
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM accounts WHERE username = $1 AND status = 'active'",
        [username],
      );
      if (rows[0]) {
        await pool.query(
          `INSERT INTO recovery_requests (account_id) VALUES ($1)
           ON CONFLICT (account_id) WHERE status IN ('pending', 'approved') DO NOTHING`,
          [rows[0].id],
        );
      }
      // Same response either way: never reveal whether a username exists.
      return reply.code(202).send({ status: 'if_account_exists_request_filed' });
    },
  );

  app.get('/v1/moderation/recovery-requests', { preHandler: moderator }, async () => {
    const { rows } = await pool.query(
      `SELECT r.id, a.username, r.created_at
         FROM recovery_requests r JOIN accounts a ON a.id = r.account_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at`,
    );
    return { requests: rows };
  });

  app.post(
    '/v1/moderation/recovery-requests/:id/decision',
    {
      preHandler: moderator,
      schema: {
        params: uuidParam,
        body: decisionBody(REASON_CODES.recovery.approve, REASON_CODES.recovery.deny),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { decision, reasonCode } = req.body as {
        decision: 'approve' | 'deny';
        reasonCode: string;
      };
      if (!reasonFits(decision, reasonCode, REASON_CODES.recovery)) {
        return reply.code(400).send({ error: 'reason_does_not_match_decision' });
      }
      const { rows } = await pool.query<{ account_id: string }>(
        `UPDATE recovery_requests SET status = $2, decided_at = now()
          WHERE id = $1 AND status = 'pending' AND account_id <> $3
          RETURNING account_id`,
        [id, decision === 'approve' ? 'approved' : 'denied', actor(req)],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'no_pending_request' });
      await logAction(pool, {
        action: `recovery.${decision === 'approve' ? 'approved' : 'denied'}`,
        reasonCode,
        actorAccountId: actor(req),
      });
      return { status: decision === 'approve' ? 'approved' : 'denied' };
    },
  );

  app.post(
    '/v1/auth/recovery/reverify',
    {
      config: { rateLimit: limits.verification },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'state', 'licenseNumber'],
          properties: {
            username: { type: 'string', maxLength: 30 },
            state: { type: 'string', minLength: 2, maxLength: 2 },
            licenseNumber: { type: 'string', minLength: 4, maxLength: 30 },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, state, licenseNumber } = req.body as {
        username: string;
        state: string;
        licenseNumber: string;
      };
      const { rows } = await pool.query<{ request_id: string; account_id: string }>(
        `SELECT r.id AS request_id, r.account_id
           FROM recovery_requests r JOIN accounts a ON a.id = r.account_id
          WHERE a.username = $1 AND a.status = 'active' AND r.status = 'approved'`,
        [username],
      );
      const open = rows[0];
      let match = false;
      if (open) {
        try {
          match = await vault.matchIdentity(open.account_id, { state, licenseNumber });
        } catch (err) {
          if (!(err instanceof VaultClientError)) throw err;
        }
      }
      if (!open || !match) return reply.code(400).send({ error: 'recovery_not_possible' });

      // Single use: the approval is consumed whether or not a passkey is registered next.
      await pool.query("UPDATE recovery_requests SET status = 'used' WHERE id = $1", [
        open.request_id,
      ]);
      return { token: await createSession(pool, open.account_id, 'recovery') };
    },
  );
}
