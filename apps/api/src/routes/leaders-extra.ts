import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { OFFICE_LEVEL } from '../civic/rollups.js';
import { categoryScores, overall } from '../civic/scores.js';
import { matchSource } from '../civic/trust.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';

/**
 * Leader stances with a timeline (R12) and head-to-head comparison (R14).
 * Stances are added by moderators with an approved source and logged; the
 * history is kept, so a change of position shows as a new entry.
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const slugParam = {
  type: 'object',
  properties: { slug: { type: 'string', pattern: '^[a-z0-9-]{2,80}$' } },
} as const;

export async function leaderExtraRoutes(app: FastifyInstance, deps: { pool: Pool }) {
  const { pool } = deps;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });
  const moderatorOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await isModerator(pool, req.session!.accountId)))
      return reply.code(403).send({ error: 'moderator_only' });
  };

  async function stancesOf(leaderId: string) {
    const { rows } = await pool.query<{
      id: string;
      categorySlug: string;
      categoryName: string;
      position: string;
      statement: string;
      sourceUrl: string;
      sourceName: string;
      stated_on: Date;
    }>(
      `SELECT s.id, c.slug AS "categorySlug", c.name AS "categoryName", s.position, s.statement,
              s.source_url AS "sourceUrl", a.name AS "sourceName", s.stated_on
         FROM leader_stances s JOIN communities c ON c.id = s.category_id
         JOIN approved_sources a ON a.domain = s.source_domain
        WHERE s.leader_id = $1 ORDER BY c.name, s.stated_on DESC`,
      [leaderId],
    );
    return rows.map(({ stated_on, ...r }) => ({
      ...r,
      statedOn: stated_on.toISOString().slice(0, 10),
    }));
  }

  app.get('/v1/leaders/:slug/stances', { schema: { params: slugParam } }, async (req, reply) => {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM leaders WHERE slug = $1', [
      (req.params as { slug: string }).slug,
    ]);
    if (!rows[0]) return notFound(reply);
    return { stances: await stancesOf(rows[0].id) };
  });

  app.post(
    '/v1/moderation/leaders/:slug/stances',
    {
      preHandler: [member, moderatorOnly],
      schema: {
        params: slugParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'position', 'statement', 'sourceUrl', 'statedOn'],
          properties: {
            category: { type: 'string', pattern: '^[a-z0-9-]{2,60}$' },
            position: { type: 'string', enum: ['support', 'oppose', 'mixed'] },
            statement: { type: 'string', minLength: 10, maxLength: 1000 },
            sourceUrl: { type: 'string', minLength: 10, maxLength: 2000 },
            statedOn: { type: 'string', format: 'date' },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body as {
        category: string;
        position: string;
        statement: string;
        sourceUrl: string;
        statedOn: string;
      };
      const { rows: l } = await pool.query<{
        id: string;
        office_kind: string;
        account_id: string | null;
      }>('SELECT id, office_kind, account_id FROM leaders WHERE slug = $1', [
        (req.params as { slug: string }).slug,
      ]);
      if (!l[0]) return notFound(reply);
      if (l[0].account_id === req.session!.accountId)
        return reply.code(403).send({ error: 'cannot_decide_own_case' });
      const { rows: cat } = await pool.query<{ id: string; applies: boolean }>(
        `SELECT c.id, EXISTS (SELECT 1 FROM category_levels cl WHERE cl.category_id = c.id AND cl.level = $2) AS applies
           FROM communities c WHERE c.slug = $1 AND c.kind = 'topic'`,
        [b.category, OFFICE_LEVEL[l[0].office_kind] ?? 'federal'],
      );
      if (!cat[0]) return reply.code(400).send({ error: 'unknown_category' });
      if (!cat[0].applies) return reply.code(400).send({ error: 'category_not_applicable' });
      const { rows: domains } = await pool.query<{ domain: string }>(
        'SELECT domain FROM approved_sources',
      );
      const domain = matchSource(
        b.sourceUrl,
        domains.map((d) => d.domain),
      );
      if (!domain) return reply.code(422).send({ error: 'source_not_approved' });
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO leader_stances (leader_id, category_id, position, statement, source_url, source_domain, stated_on, added_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          l[0].id,
          cat[0].id,
          b.position,
          b.statement.trim(),
          b.sourceUrl,
          domain,
          b.statedOn,
          req.session!.accountId,
        ],
      );
      await logAction(pool, {
        action: 'stance.added',
        reasonCode: REASON_CODES.stance[0],
        actorAccountId: req.session!.accountId,
      });
      return reply.code(201).send({ id: rows[0]!.id });
    },
  );

  /** Head-to-head: both leaders' category scores, latest stances and overall. */
  app.get(
    '/v1/compare',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['a', 'b'],
          properties: {
            a: { type: 'string', pattern: '^[a-z0-9-]{2,80}$' },
            b: { type: 'string', pattern: '^[a-z0-9-]{2,80}$' },
          },
        },
      },
    },
    async (req, reply) => {
      const { a, b } = req.query as { a: string; b: string };
      if (a === b) return reply.code(400).send({ error: 'pick_two_different_leaders' });
      const { rows } = await pool.query<{
        id: string;
        slug: string;
        name: string;
        office: string;
        party: string;
        photo_url: string | null;
        in_office: boolean;
      }>(
        'SELECT id, slug, name, office, party, photo_url, in_office FROM leaders WHERE slug = ANY($1::text[])',
        [[a, b]],
      );
      const left = rows.find((r) => r.slug === a);
      const right = rows.find((r) => r.slug === b);
      if (!left || !right) return notFound(reply);
      const side = async (l: typeof left) => {
        const [scores, ov, stances, counts] = await Promise.all([
          categoryScores(pool, 'leader', l.id),
          overall(pool, 'leader', l.id),
          stancesOf(l.id),
          pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM citations WHERE leader_id = $1 AND status = 'accepted'",
            [l.id],
          ),
        ]);
        return {
          leader: {
            slug: l.slug,
            name: l.name,
            office: l.office,
            party: l.party,
            photoUrl: l.photo_url,
            inOffice: l.in_office,
          },
          overall: ov,
          citations: counts.rows[0]?.n ?? 0,
          scores: Object.fromEntries(scores.map((s) => [s.category.slug, s])),
          // Latest stance per category.
          stances: Object.fromEntries(stances.map((s) => [s.categorySlug, s] as const).reverse()),
        };
      };
      const [L, R] = await Promise.all([side(left), side(right)]);
      const categories = Object.values(L.scores)
        .filter((s) => s.applicable || R.scores[s.category.slug]?.applicable)
        .map((s) => s.category);
      return { a: L, b: R, categories };
    },
  );
}
