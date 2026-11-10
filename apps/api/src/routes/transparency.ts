import type { FastifyInstance } from 'fastify';
import type { Pool } from '@demanity/db';

/**
 * Transparency report numbers (R28; docs/TRANSPARENCY-REPORT-TEMPLATE.md) and
 * the disabled contextual-ad slot (R11; docs/ADS.md).
 *
 * The report endpoint only aggregates what is already public: the moderation
 * log, citation decisions by the cited leader's party (to check that
 * enforcement is symmetric), fact-check outcomes and moderator lean totals.
 * It never returns accounts, usernames or moderators.
 */

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const DAY = 86_400_000;

/** Ads are off at MVP and can only ever be contextual (docs/ADS.md). */
export const ADS_ENABLED = false;

export async function transparencyRoutes(app: FastifyInstance, deps: { pool: Pool }) {
  const { pool } = deps;

  app.get(
    '/v1/transparency',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { from: date, to: date },
        },
      },
    },
    async (req, reply) => {
      const q = req.query as { from?: string; to?: string };
      const to = q.to ? new Date(`${q.to}T00:00:00Z`) : new Date();
      const from = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(to.getTime() - 90 * DAY);
      if (!(from < to) || to.getTime() - from.getTime() > 366 * DAY)
        return reply.code(400).send({ error: 'invalid_period' });
      const range = [from.toISOString(), to.toISOString()];

      const { rows: actions } = await pool.query<{
        action: string;
        reason_code: string;
        actor_role: string;
        n: number;
      }>(
        `SELECT action, reason_code, actor_role, count(*)::int AS n FROM moderation_log
          WHERE created_at >= $1 AND created_at < $2
          GROUP BY action, reason_code, actor_role ORDER BY action, reason_code`,
        range,
      );
      const { rows: citations } = await pool.query<{
        party: string;
        direction: string;
        status: string;
        n: number;
      }>(
        `SELECT coalesce(l.party, 'None listed') AS party, c.direction, c.status, count(*)::int AS n
           FROM citations c JOIN leaders l ON l.id = c.leader_id
          WHERE c.created_at >= $1 AND c.created_at < $2
          GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
        range,
      );
      const { rows: factChecks } = await pool.query<{
        trigger: string;
        outcome: string;
        n: number;
      }>(
        `SELECT trigger, outcome, count(*)::int AS n FROM fact_checks
          WHERE status = 'decided' AND decided_at >= $1 AND decided_at < $2
          GROUP BY 1, 2 ORDER BY 1, 2`,
        range,
      );
      const { rows: appeals } = await pool.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM appeals
          WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 1`,
        range,
      );
      const { rows: leans } = await pool.query<{ lean: string; n: number }>(
        `SELECT l.lean, count(*)::int AS n FROM moderator_leans l
           JOIN account_roles r ON r.account_id = l.account_id AND r.role = 'moderator'
          GROUP BY 1 ORDER BY 1`,
      );
      const { rows: mods } = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM account_roles WHERE role = 'moderator'",
      );

      return {
        period: { from: range[0], to: range[1] },
        moderationActions: actions.map((a) => ({
          action: a.action,
          reasonCode: a.reason_code,
          actor: a.actor_role,
          count: a.n,
        })),
        citationsByParty: citations,
        factChecks,
        appeals,
        moderators: { total: mods[0]!.n, declaredLeans: leans },
        ads: { enabled: ADS_ENABLED, impressions: 0 },
        notes: [
          'Counts come from the public moderation log and public records; no account is identified.',
          'Citation decisions are grouped by the cited leader’s party so readers can check that enforcement is symmetric.',
          'Legal requests for user data, security incidents and staffing are reported by hand (docs/TRANSPARENCY-REPORT-TEMPLATE.md).',
        ],
      };
    },
  );

  /**
   * Contextual-ad slot. Off at MVP. It takes only the page's context (for
   * example "bill:health") and deliberately never reads the session, so an ad
   * could never be chosen from who is looking.
   */
  app.get(
    '/v1/ads/slot',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['context'],
          properties: { context: { type: 'string', pattern: '^[a-z_]{2,20}:[a-z0-9-]{1,60}$' } },
        },
      },
    },
    async (_req, reply) => {
      reply.header('cache-control', 'public, max-age=3600');
      return {
        enabled: ADS_ENABLED,
        ad: null,
        policy:
          'Demanity shows no ads at launch. If that ever changes, ads will be contextual only: chosen from the page’s topic, never from data about you, and never political.',
      };
    },
  );
}
