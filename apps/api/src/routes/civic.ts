import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { ResponseCache } from '../cache.js';
import { GALLONS_PER_MONTH, peerLabel } from '../civic/rollups.js';
import { categoryScores, overall, overallScores } from '../civic/scores.js';
import { REASON_CODES } from '../moderation/reasons.js';
import { isModerator, logAction } from '../moderation/service.js';
import type { RouteLimits } from '../rate-limit.js';

/**
 * Civic pages (R12, R13, R17, R23, R32): places, leaders, bills, bill stances,
 * leader requests, mock election ballots, Humanity guides and search.
 *
 * Public pages that look the same for everyone (place, leader, scores,
 * guides) are served from a shared response cache over precomputed data, so
 * a request does no score math (docs/adr/0007-precomputed-civic-data.md).
 * Viewer-specific bits (your vote, whether you follow) come from separate
 * small endpoints.
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const uuid = { type: 'string', format: 'uuid' } as const;
const slugPattern = '^[a-z0-9-]{2,80}$';
const slugParam = {
  type: 'object',
  properties: { slug: { type: 'string', pattern: slugPattern } },
} as const;
const idParam = { type: 'object', properties: { id: uuid } } as const;

const viewer = (req: FastifyRequest) => req.session?.accountId ?? null;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Votes at which a leader is expected to respond publicly (docs/LEGISLATION.md §3b). */
export const REQUEST_RESPONSE_THRESHOLD = 25;

export type BillStage = 'proposed' | 'voting' | 'decided';
const STAGE_SQL = `CASE WHEN b.status = 'introduced' THEN 'proposed'
                        WHEN b.status IN ('in_committee', 'passed_chamber', 'passed') THEN 'voting'
                        ELSE 'decided' END`;

export interface BillView {
  id: string;
  number: string;
  title: string;
  summary: string;
  impact: string;
  status: string;
  stage: BillStage;
  introducedAt: string;
  lastActionAt: string;
  sourceUrl: string | null;
  isSample: boolean;
  level: 'federal' | 'state';
  place: { slug: string; name: string };
  category: { slug: string; name: string } | null;
  sponsors: Array<{ slug: string; name: string; party: string; role: string }>;
  bipartisan: boolean;
  weighedIn: boolean;
  /** Only shown after the viewer has weighed in, to avoid bandwagon effects. */
  tally: { support: number; oppose: number } | null;
  reason?: string;
}

/** Bill rows; $1 is the viewer (or null). `extra` adds columns. */
export const billSelect = (extra = '') => `
  SELECT b.id, b.number, b.title, b.summary, b.impact, b.status, ${STAGE_SQL} AS stage,
         b.introduced_at, b.last_action_at, b.source_url, b.is_sample, p.kind AS place_kind,
         p.slug AS place_slug, p.name AS place_name, c.slug AS category_slug, c.name AS category_name,
         COALESCE((SELECT json_agg(json_build_object('slug', l.slug, 'name', l.name, 'party', l.party, 'role', s.role)
                                   ORDER BY s.role DESC, l.name)
                     FROM bill_sponsors s JOIN leaders l ON l.id = s.leader_id WHERE s.bill_id = b.id), '[]') AS sponsors,
         (SELECT count(DISTINCT l.party) FROM bill_sponsors s JOIN leaders l ON l.id = s.leader_id
           WHERE s.bill_id = b.id AND l.party <> '') AS parties,
         EXISTS (SELECT 1 FROM bill_swipes w WHERE w.bill_id = b.id AND w.account_id = $1) AS weighed_in,
         t.support, t.oppose${extra}
    FROM bills b
    JOIN places p ON p.id = b.place_id
    LEFT JOIN communities c ON c.id = b.category_id
    LEFT JOIN bill_tallies t ON t.bill_id = b.id`;
const BILL_SELECT = billSelect();

export interface BillRow {
  id: string;
  number: string;
  title: string;
  summary: string;
  impact: string;
  status: string;
  stage: BillStage;
  introduced_at: Date;
  last_action_at: Date;
  source_url: string | null;
  is_sample: boolean;
  place_kind: string;
  place_slug: string;
  place_name: string;
  category_slug: string | null;
  category_name: string | null;
  sponsors: BillView['sponsors'];
  parties: string;
  weighed_in: boolean;
  support: number | null;
  oppose: number | null;
  reason?: string | null;
}

export function billView(r: BillRow): BillView {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    summary: r.summary,
    impact: r.impact,
    status: r.status,
    stage: r.stage,
    introducedAt: day(r.introduced_at)!,
    lastActionAt: day(r.last_action_at)!,
    sourceUrl: r.source_url,
    isSample: r.is_sample,
    level: r.place_kind === 'nation' ? 'federal' : 'state',
    place: { slug: r.place_slug, name: r.place_name },
    category: r.category_slug ? { slug: r.category_slug, name: r.category_name! } : null,
    sponsors: r.sponsors,
    bipartisan: Number(r.parties) >= 2,
    weighedIn: r.weighed_in,
    tally: r.weighed_in ? { support: r.support ?? 0, oppose: r.oppose ?? 0 } : null,
    ...(r.reason ? { reason: r.reason } : {}),
  };
}

export interface BillFilter {
  scope?: 'federal' | 'state';
  place?: string;
  category?: string;
  stage?: BillStage;
  bipartisan?: boolean;
}

const billFilterSchema = {
  scope: { type: 'string', enum: ['federal', 'state'] },
  place: { type: 'string', pattern: slugPattern },
  category: { type: 'string', pattern: slugPattern },
  stage: { type: 'string', enum: ['proposed', 'voting', 'decided'] },
  bipartisan: { type: 'boolean' },
} as const;

/** WHERE clause for bill filters; parameters start at $2 ($1 is the viewer). */
function billWhere(f: BillFilter): { sql: string; params: unknown[] } {
  const parts: string[] = ['TRUE'];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    parts.push(sql.replace('?', `$${params.length + 1}`));
  };
  if (f.scope === 'federal') parts.push("p.kind = 'nation'");
  if (f.scope === 'state') parts.push("p.kind <> 'nation'");
  if (f.place) add('p.slug = ?', f.place);
  if (f.category) add('c.slug = ?', f.category);
  if (f.stage) add(`${STAGE_SQL} = ?`, f.stage);
  if (f.bipartisan)
    parts.push(`(SELECT count(DISTINCT l.party) FROM bill_sponsors s JOIN leaders l ON l.id = s.leader_id
                  WHERE s.bill_id = b.id AND l.party <> '') >= 2`);
  return { sql: parts.join(' AND '), params };
}

/** Why a bill is relevant to the viewer ($1): followed bill, leader, place or topic. */
export const RELEVANCE_SQL = `CASE
  WHEN EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.target_type = 'bill' AND f.target_id = b.id)
    THEN 'You follow this bill'
  WHEN EXISTS (SELECT 1 FROM follows f JOIN bill_sponsors s ON s.leader_id = f.target_id
                WHERE f.follower_id = $1 AND f.target_type = 'leader' AND s.bill_id = b.id)
    THEN 'Sponsored by a leader you follow'
  WHEN EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1
                 AND ((f.target_type = 'place' AND f.target_id = b.place_id)
                   OR (f.target_type = 'community' AND f.target_id = p.community_id)))
    THEN 'In ' || p.name || ', which you follow'
  WHEN EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.target_type = 'community'
                 AND f.target_id = b.category_id)
    THEN 'In ' || c.name || ', which you follow'
  ELSE NULL END`;

/** Escapes LIKE wildcards so search input is matched literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export async function civicRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; limits: RouteLimits; cache?: ResponseCache },
) {
  const { pool, limits } = deps;
  const cache = deps.cache ?? new ResponseCache(pool);
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

  async function placeBySlug(slug: string) {
    const { rows } = await pool.query<{
      id: string;
      slug: string;
      name: string;
      kind: string;
      population: number | null;
      is_sample: boolean;
      peer_group: string | null;
      parent_slug: string | null;
      parent_name: string | null;
      community_slug: string | null;
    }>(
      `SELECT p.id, p.slug, p.name, p.kind, p.population, p.is_sample, p.peer_group,
              pp.slug AS parent_slug, pp.name AS parent_name, c.slug AS community_slug
         FROM places p LEFT JOIN places pp ON pp.id = p.parent_id
         LEFT JOIN communities c ON c.id = p.community_id
        WHERE p.slug = $1`,
      [slug],
    );
    return rows[0] ?? null;
  }

  async function leaderBySlug(slug: string) {
    const { rows } = await pool.query<{
      id: string;
      slug: string;
      name: string;
      office: string;
      office_kind: string;
      party: string;
      in_office: boolean;
      bio: string;
      is_sample: boolean;
      account_id: string | null;
      place_slug: string | null;
      place_name: string | null;
    }>(
      `SELECT l.id, l.slug, l.name, l.office, l.office_kind, l.party, l.in_office, l.bio, l.is_sample,
              l.account_id, p.slug AS place_slug, p.name AS place_name
         FROM leaders l LEFT JOIN places p ON p.id = l.place_id WHERE l.slug = $1`,
      [slug],
    );
    return rows[0] ?? null;
  }

  async function leadersAt(placeId: string) {
    const { rows } = await pool.query<{
      id: string;
      slug: string;
      name: string;
      office: string;
      party: string;
      is_sample: boolean;
    }>(
      `SELECT id, slug, name, office, party, is_sample FROM leaders
        WHERE place_id = $1 AND in_office
        ORDER BY array_position(ARRAY['president','governor','us_senate','us_house','mayor','county_executive','state_senate','state_house'], office_kind), name`,
      [placeId],
    );
    const scores = await overallScores(
      pool,
      'leader',
      rows.map((r) => r.id),
    );
    return rows.map(({ id, is_sample, ...l }) => ({
      ...l,
      isSample: is_sample,
      overall: scores.get(id) ?? null,
    }));
  }

  // --- Places (cached: identical for every viewer) ------------------------------

  app.get(
    '/v1/places',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: {
              type: 'string',
              enum: [
                'nation',
                'state',
                'county',
                'city',
                'court_district',
                'congressional_district',
              ],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { kind } = req.query as { kind?: string };
      return cache.serve(req, reply, `places:${kind ?? ''}`, async () => {
        const { rows } = await pool.query(
          `SELECT p.slug, p.name, p.kind, pp.name AS "parentName" FROM places p
             LEFT JOIN places pp ON pp.id = p.parent_id
            WHERE ($1::text IS NULL OR p.kind = $1) ORDER BY p.kind, p.name`,
          [kind ?? null],
        );
        return { places: rows };
      });
    },
  );

  app.get('/v1/places/:slug', { schema: { params: slugParam } }, async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    return cache.serve(req, reply, `place:${slug}`, async () => {
      const place = await placeBySlug(slug);
      if (!place) return null;
      const [children, issues, elections, stats, cost, bills, ov, leaders] = await Promise.all([
        pool.query(`SELECT slug, name, kind FROM places WHERE parent_id = $1 ORDER BY kind, name`, [
          place.id,
        ]),
        pool.query(
          `SELECT i.rank, i.title, i.summary, i.source_label AS "sourceLabel", i.source_url AS "sourceUrl",
                  i.is_sample AS "isSample", c.slug AS "categorySlug", c.name AS "categoryName"
             FROM place_issues i LEFT JOIN communities c ON c.id = i.category_id
            WHERE i.place_id = $1 ORDER BY i.rank`,
          [place.id],
        ),
        pool.query<{ election_date: Date }>(
          `SELECT e.id, e.office, e.kind, e.election_date, e.source_label AS "sourceLabel",
                  e.source_url AS "sourceUrl", e.is_sample AS "isSample",
                  (SELECT count(*)::int FROM election_candidates ec WHERE ec.election_id = e.id) AS candidates
             FROM elections e WHERE e.place_id = $1 AND e.election_date >= CURRENT_DATE
            ORDER BY e.election_date LIMIT 10`,
          [place.id],
        ),
        pool.query<{ value: string; peer_median: string | null; as_of: Date }>(
          `SELECT key, label, value, unit, higher_is_better AS "higherIsBetter",
                  source_label AS "sourceLabel", source_url AS "sourceUrl", as_of,
                  is_sample AS "isSample", peer_median, peer_count AS "peerCount"
             FROM place_stats WHERE place_id = $1
            ORDER BY array_position(ARRAY['cost_of_living','median_income','median_rent','groceries','childcare','gas_price','electric_bill','unemployment','uninsured','commute'], key), label`,
          [place.id],
        ),
        pool.query<{
          basics_monthly: number;
          basics_peer_median: number | null;
          basics_peer_count: number | null;
          real_income: number | null;
        }>('SELECT * FROM place_cost_rollups WHERE place_id = $1', [place.id]),
        pool.query<BillRow>(
          `${BILL_SELECT} WHERE b.place_id = $2 ORDER BY b.last_action_at DESC, b.id DESC LIMIT 5`,
          [null, place.id],
        ),
        overall(pool, 'place', place.id),
        leadersAt(place.id),
      ]);
      const c = cost.rows[0];
      return {
        slug: place.slug,
        name: place.name,
        kind: place.kind,
        population: place.population,
        isSample: place.is_sample,
        peerGroup: place.peer_group ?? place.kind,
        peerLabel: peerLabel(place.peer_group ?? place.kind),
        parent: place.parent_slug ? { slug: place.parent_slug, name: place.parent_name } : null,
        community: place.community_slug,
        children: children.rows,
        overall: ov,
        issues: issues.rows,
        elections: elections.rows.map(({ election_date, ...e }) => ({
          ...e,
          electionDate: day(election_date),
        })),
        leaders,
        stats: stats.rows.map(({ value, peer_median, as_of, ...s }) => ({
          ...s,
          value: Number(value),
          peerMedian: peer_median === null ? null : Number(peer_median),
          asOf: day(as_of),
        })),
        cost: c
          ? {
              basicsMonthly: c.basics_monthly,
              peerMedian: c.basics_peer_median,
              peerCount: c.basics_peer_count,
              realIncome: c.real_income,
              gallonsPerMonth: GALLONS_PER_MONTH,
              formula: `Median rent + groceries (one adult) + average electric bill + ${GALLONS_PER_MONTH} gallons of gasoline, per month. Real income = median household income ÷ (cost-of-living index ÷ 100).`,
            }
          : null,
        recentBills: bills.rows.map(billView),
      };
    });
  });

  app.get('/v1/places/:slug/scores', { schema: { params: slugParam } }, async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    return cache.serve(req, reply, `place-scores:${slug}`, async () => {
      const place = await placeBySlug(slug);
      if (!place) return null;
      const ov = await overall(pool, 'place', place.id);
      return {
        kind: 'conditions',
        subjectKind: place.kind,
        peerGroup: ov.peerGroup || place.kind,
        peerLabel: ov.peerLabel || peerLabel(place.kind),
        overall: ov,
        categories: await categoryScores(pool, 'place', place.id),
      };
    });
  });

  // --- Leaders (cached) -------------------------------------------------------------

  app.get('/v1/leaders/:slug', { schema: { params: slugParam } }, async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    return cache.serve(req, reply, `leader:${slug}`, async () => {
      const l = await leaderBySlug(slug);
      if (!l) return null;
      const sponsored = await pool.query<BillRow>(
        `${BILL_SELECT} JOIN bill_sponsors bs ON bs.bill_id = b.id AND bs.leader_id = $2
          ORDER BY (b.status IN ('passed', 'signed')) DESC, b.last_action_at DESC, b.id DESC LIMIT 20`,
        [null, l.id],
      );
      const bills = sponsored.rows.map(billView);
      return {
        slug: l.slug,
        name: l.name,
        office: l.office,
        officeKind: l.office_kind,
        party: l.party,
        inOffice: l.in_office,
        claimed: l.account_id !== null,
        bio: l.bio,
        isSample: l.is_sample,
        place: l.place_slug ? { slug: l.place_slug, name: l.place_name } : null,
        overall: await overall(pool, 'leader', l.id),
        passed: bills.filter((b) => b.status === 'signed' || b.status === 'passed'),
        sponsored: bills.filter((b) => b.status !== 'signed' && b.status !== 'passed'),
      };
    });
  });

  app.get('/v1/leaders/:slug/scores', { schema: { params: slugParam } }, async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    return cache.serve(req, reply, `leader-scores:${slug}`, async () => {
      const l = await leaderBySlug(slug);
      if (!l) return null;
      const ov = await overall(pool, 'leader', l.id);
      return {
        kind: 'trust',
        subjectKind: l.office_kind,
        peerGroup: ov.peerGroup || `leader:${l.office_kind}`,
        peerLabel: ov.peerLabel || peerLabel(l.office_kind),
        overall: ov,
        categories: await categoryScores(pool, 'leader', l.id),
      };
    });
  });

  // --- Leader requests and the accountability loop ------------------------------------

  app.get('/v1/leaders/:slug/requests', { schema: { params: slugParam } }, async (req, reply) => {
    const l = await leaderBySlug((req.params as { slug: string }).slug);
    if (!l) return notFound(reply);
    const { rows } = await pool.query<{
      username: string | null;
      threshold_reached_at: Date | null;
      status: string;
    }>(
      `SELECT r.id, r.title, r.body, r.status, r.response, r.responded_at AS "respondedAt",
                r.created_at AS "createdAt", r.threshold_reached_at, a.username,
                (SELECT count(*)::int FROM leader_request_votes v WHERE v.request_id = r.id) AS votes,
                (SELECT count(*)::int FROM leader_requests m WHERE m.merged_into = r.id) AS "mergedCount",
                EXISTS (SELECT 1 FROM leader_request_votes v WHERE v.request_id = r.id AND v.account_id = $2) AS "myVote"
           FROM leader_requests r LEFT JOIN accounts a ON a.id = r.author_id
          WHERE r.leader_id = $1 AND r.status NOT IN ('removed', 'merged')
          ORDER BY votes DESC, r.created_at DESC LIMIT 100`,
      [l.id, viewer(req)],
    );
    const now = Date.now();
    return {
      threshold: REQUEST_RESPONSE_THRESHOLD,
      requests: rows.map(({ username, threshold_reached_at, ...r }) => {
        const awaiting =
          threshold_reached_at !== null && (r.status === 'open' || r.status === 'acknowledged');
        return {
          ...r,
          author: username ? { username } : null,
          awaitingResponseDays: awaiting
            ? Math.floor((now - threshold_reached_at.getTime()) / 86_400_000)
            : null,
        };
      }),
    };
  });

  app.post(
    '/v1/leaders/:slug/requests',
    {
      preHandler: member,
      config: { rateLimit: limits.request },
      schema: {
        params: slugParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 5, maxLength: 140 },
            body: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      const l = await leaderBySlug((req.params as { slug: string }).slug);
      if (!l) return notFound(reply);
      if (!l.in_office) return reply.code(409).send({ error: 'leader_not_in_office' });
      const { title, body } = req.body as { title: string; body?: string };
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO leader_requests (leader_id, author_id, title, body) VALUES ($1, $2, $3, $4) RETURNING id',
        [l.id, req.session!.accountId, title.trim(), (body ?? '').trim()],
      );
      await vote(req.session!.accountId, rows[0]!.id); // authors support their own request
      return reply.code(201).send({ id: rows[0]!.id });
    },
  );

  /** Adds a vote and records when the request first reaches the response threshold. */
  async function vote(accountId: string, requestId: string) {
    await pool.query(
      'INSERT INTO leader_request_votes (account_id, request_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [accountId, requestId],
    );
    await pool.query(
      `UPDATE leader_requests SET threshold_reached_at = now()
        WHERE id = $1 AND threshold_reached_at IS NULL
          AND (SELECT count(*) FROM leader_request_votes WHERE request_id = $1) >= $2`,
      [requestId, REQUEST_RESPONSE_THRESHOLD],
    );
  }

  app.put(
    '/v1/leader-requests/:id/vote',
    { preHandler: member, schema: { params: idParam } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { rowCount } = await pool.query(
        "SELECT 1 FROM leader_requests WHERE id = $1 AND status NOT IN ('removed', 'merged')",
        [id],
      );
      if (!rowCount) return notFound(reply);
      await vote(req.session!.accountId, id);
      return reply.code(204).send();
    },
  );

  app.delete(
    '/v1/leader-requests/:id/vote',
    { preHandler: member, schema: { params: idParam } },
    async (req, reply) => {
      await pool.query(
        'DELETE FROM leader_request_votes WHERE account_id = $1 AND request_id = $2',
        [req.session!.accountId, (req.params as { id: string }).id],
      );
      return reply.code(204).send();
    },
  );

  /**
   * Status changes:
   * - the leader (claimed account): acknowledged, responded (with a response), done;
   * - moderators: done (documented action), removed, merged (into another
   *   request for the same leader; votes move over). Each moderator action
   *   cites a published reason code and goes to the public moderation log.
   */
  app.patch(
    '/v1/leader-requests/:id',
    {
      preHandler: member,
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: ['acknowledged', 'responded', 'done', 'removed', 'merged'],
            },
            response: { type: 'string', minLength: 1, maxLength: 4000 },
            mergeInto: uuid,
            reasonCode: { type: 'string', enum: [...REASON_CODES.request] },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        status: string;
        response?: string;
        mergeInto?: string;
        reasonCode?: string;
      };
      const { rows } = await pool.query<{ leader_id: string; account_id: string | null }>(
        `SELECT r.leader_id, l.account_id FROM leader_requests r JOIN leaders l ON l.id = r.leader_id
          WHERE r.id = $1 AND r.status NOT IN ('removed', 'merged')`,
        [id],
      );
      const target = rows[0];
      if (!target) return notFound(reply);
      const me = req.session!.accountId;
      const isLeader = target.account_id === me;
      const isMod = !isLeader && (await isModerator(pool, me));
      const leaderMay = ['acknowledged', 'responded', 'done'];
      const modMay = ['done', 'removed', 'merged'];
      if (
        !(isLeader && leaderMay.includes(body.status)) &&
        !(isMod && modMay.includes(body.status))
      )
        return reply.code(403).send({ error: 'not_allowed' });
      if (body.status === 'responded' && !body.response)
        return reply.code(400).send({ error: 'response_required' });
      if (isMod && !body.reasonCode) return reply.code(400).send({ error: 'reason_required' });

      if (body.status === 'merged') {
        if (!body.mergeInto || body.mergeInto === id)
          return reply.code(400).send({ error: 'merge_target_required' });
        const { rowCount } = await pool.query(
          "SELECT 1 FROM leader_requests WHERE id = $1 AND leader_id = $2 AND status NOT IN ('removed', 'merged')",
          [body.mergeInto, target.leader_id],
        );
        if (!rowCount) return reply.code(400).send({ error: 'merge_target_invalid' });
        await pool.query(
          `INSERT INTO leader_request_votes (account_id, request_id)
           SELECT account_id, $2 FROM leader_request_votes WHERE request_id = $1 ON CONFLICT DO NOTHING`,
          [id, body.mergeInto],
        );
        await pool.query('DELETE FROM leader_request_votes WHERE request_id = $1', [id]);
        await pool.query(
          `UPDATE leader_requests SET threshold_reached_at = COALESCE(threshold_reached_at, now())
            WHERE id = $1 AND (SELECT count(*) FROM leader_request_votes WHERE request_id = $1) >= $2`,
          [body.mergeInto, REQUEST_RESPONSE_THRESHOLD],
        );
      }
      await pool.query(
        `UPDATE leader_requests
            SET status = $2, status_changed_at = now(),
                response = COALESCE($3, response),
                responded_at = CASE WHEN $3::text IS NOT NULL THEN now() ELSE responded_at END,
                merged_into = $4
          WHERE id = $1`,
        [id, body.status, body.response ?? null, body.status === 'merged' ? body.mergeInto : null],
      );
      if (isMod)
        await logAction(pool, {
          action: `request.${body.status}`,
          reasonCode: body.reasonCode!,
          actorAccountId: me,
        });
      return { status: body.status };
    },
  );

  // --- Bills and private stances ---------------------------------------------------

  app.get(
    '/v1/bills',
    {
      schema: {
        querystring: { type: 'object', additionalProperties: false, properties: billFilterSchema },
      },
    },
    async (req) => {
      const w = billWhere(req.query as BillFilter);
      const { rows } = await pool.query<BillRow>(
        `${BILL_SELECT} WHERE ${w.sql} ORDER BY b.last_action_at DESC, b.id DESC LIMIT 50`,
        [viewer(req), ...w.params],
      );
      return { bills: rows.map(billView) };
    },
  );

  /**
   * The swipe deck: bills the member hasn't weighed in on, most relevant to
   * them first (followed bills, leaders, places, topics), each with a reason;
   * then bills being voted on, then proposed, then decided.
   */
  app.get(
    '/v1/bills/deck',
    {
      preHandler: member,
      schema: {
        querystring: { type: 'object', additionalProperties: false, properties: billFilterSchema },
      },
    },
    async (req) => {
      const w = billWhere(req.query as BillFilter);
      const { rows } = await pool.query<BillRow>(
        `SELECT * FROM (${billSelect(`, ${RELEVANCE_SQL} AS reason`)}
           WHERE ${w.sql}
             AND NOT EXISTS (SELECT 1 FROM bill_swipes sw WHERE sw.bill_id = b.id AND sw.account_id = $1)) y
         ORDER BY (y.reason IS NOT NULL) DESC,
                  array_position(ARRAY['voting', 'proposed', 'decided'], y.stage),
                  y.last_action_at DESC, y.id DESC
         LIMIT 25`,
        [req.session!.accountId, ...w.params],
      );
      return { bills: rows.map(billView) };
    },
  );

  app.get('/v1/bills/:id', { schema: { params: idParam } }, async (req, reply) => {
    const { rows } = await pool.query<BillRow>(`${BILL_SELECT} WHERE b.id = $2`, [
      viewer(req),
      (req.params as { id: string }).id,
    ]);
    return rows[0] ? billView(rows[0]) : notFound(reply);
  });

  app.post(
    '/v1/bills/:id/stance',
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
      const billId = (req.params as { id: string }).id;
      const { stance } = req.body as { stance: 'support' | 'oppose' };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount: exists } = await client.query('SELECT 1 FROM bills WHERE id = $1', [
          billId,
        ]);
        if (!exists) {
          await client.query('ROLLBACK');
          return notFound(reply);
        }
        const { rowCount } = await client.query(
          'INSERT INTO bill_swipes (account_id, bill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.session!.accountId, billId],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'already_weighed_in' });
        }
        // The direction lives only in this anonymous counter (see migration 0005).
        const column = stance === 'support' ? 'support' : 'oppose';
        const { rows } = await client.query<{ support: number; oppose: number }>(
          `INSERT INTO bill_tallies (bill_id, ${column}) VALUES ($1, 1)
           ON CONFLICT (bill_id) DO UPDATE SET ${column} = bill_tallies.${column} + 1
           RETURNING support, oppose`,
          [billId],
        );
        await client.query('COMMIT');
        return { tally: rows[0] };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // --- Elections and mock ballots ----------------------------------------------------

  app.get('/v1/elections/:id', { schema: { params: idParam } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query<{
      id: string;
      office: string;
      kind: string;
      election_date: Date;
      source_label: string;
      source_url: string | null;
      is_sample: boolean;
      place_slug: string;
      place_name: string;
      voted: boolean;
    }>(
      `SELECT e.id, e.office, e.kind, e.election_date, e.source_label, e.source_url, e.is_sample,
              p.slug AS place_slug, p.name AS place_name,
              EXISTS (SELECT 1 FROM election_ballots b WHERE b.election_id = e.id AND b.account_id = $2) AS voted
         FROM elections e JOIN places p ON p.id = e.place_id WHERE e.id = $1`,
      [id, viewer(req)],
    );
    const e = rows[0];
    if (!e) return notFound(reply);
    const { rows: cands } = await pool.query<{
      id: string;
      name: string;
      party: string;
      leader_slug: string | null;
      actual_pct: string | null;
      votes: number;
      is_sample: boolean;
    }>(
      `SELECT ec.id, ec.name, ec.party, l.slug AS leader_slug, ec.actual_pct, ec.is_sample,
              COALESCE(t.votes, 0) AS votes
         FROM election_candidates ec LEFT JOIN leaders l ON l.id = ec.leader_id
         LEFT JOIN election_tallies t ON t.candidate_id = ec.id
        WHERE ec.election_id = $1 ORDER BY ec.name`,
      [id],
    );
    const closed = e.election_date.getTime() < Date.now() - 86_400_000;
    const showResults = e.voted || closed;
    const total = cands.reduce((n, c) => n + c.votes, 0);
    const actualKnown = cands.some((c) => c.actual_pct !== null);
    // Accuracy once official results exist: mean absolute error in percentage points.
    const accuracy =
      actualKnown && total > 0
        ? Math.round(
            (cands.reduce(
              (s, c) => s + Math.abs((c.votes / total) * 100 - Number(c.actual_pct ?? 0)),
              0,
            ) /
              cands.length) *
              10,
          ) / 10
        : null;
    return {
      id: e.id,
      office: e.office,
      kind: e.kind,
      electionDate: day(e.election_date),
      sourceLabel: e.source_label,
      sourceUrl: e.source_url,
      isSample: e.is_sample || cands.some((c) => c.is_sample),
      place: { slug: e.place_slug, name: e.place_name },
      voted: e.voted,
      closed,
      total: showResults ? total : null,
      candidates: cands.map((c) => ({
        id: c.id,
        name: c.name,
        party: c.party,
        leaderSlug: c.leader_slug,
        votes: showResults ? c.votes : null,
        actualPct: c.actual_pct === null ? null : Number(c.actual_pct),
      })),
      meanAbsoluteErrorPoints: accuracy,
    };
  });

  app.post(
    '/v1/elections/:id/ballot',
    {
      preHandler: member,
      config: { rateLimit: limits.stance },
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['candidateId', 'residentAttested'],
          properties: { candidateId: uuid, residentAttested: { type: 'boolean', const: true } },
        },
      },
    },
    async (req, reply) => {
      const electionId = (req.params as { id: string }).id;
      const { candidateId } = req.body as { candidateId: string };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ open: boolean }>(
          `SELECT e.election_date >= CURRENT_DATE AS open FROM election_candidates ec
             JOIN elections e ON e.id = ec.election_id WHERE ec.id = $1 AND e.id = $2`,
          [candidateId, electionId],
        );
        if (!rows[0]) {
          await client.query('ROLLBACK');
          return notFound(reply);
        }
        if (!rows[0].open) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'election_closed' });
        }
        const { rowCount } = await client.query(
          'INSERT INTO election_ballots (account_id, election_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.session!.accountId, electionId],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'already_voted' });
        }
        await client.query(
          `INSERT INTO election_tallies (candidate_id, votes) VALUES ($1, 1)
           ON CONFLICT (candidate_id) DO UPDATE SET votes = election_tallies.votes + 1`,
          [candidateId],
        );
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

  // --- Humanity guides (cached) ---------------------------------------------------------

  app.get('/v1/guides', async (req, reply) =>
    cache.serve(req, reply, 'guides', async () => {
      const { rows } = await pool.query(
        `SELECT slug, topic, title, summary, reading_minutes AS "readingMinutes" FROM guides
          ORDER BY array_position(ARRAY['civics','voting','cost-of-living','media-literacy','community'], topic), title`,
      );
      return { guides: rows };
    }),
  );

  app.get('/v1/guides/:slug', { schema: { params: slugParam } }, async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    return cache.serve(req, reply, `guide:${slug}`, async () => {
      const { rows } = await pool.query<{ updated_at: Date }>(
        `SELECT slug, topic, title, summary, body, sources, reading_minutes AS "readingMinutes", updated_at
           FROM guides WHERE slug = $1`,
        [slug],
      );
      if (!rows[0]) return null;
      const { updated_at, ...g } = rows[0];
      return { ...g, updatedAt: day(updated_at) };
    });
  });

  // --- Search ------------------------------------------------------------------------
  // Humanity is a section of its own (bottom tab), not a searchable topic, so
  // the Humanity community and its posts are left out.

  app.get(
    '/v1/search',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['q'],
          properties: { q: { type: 'string', minLength: 2, maxLength: 80 } },
        },
      },
    },
    async (req) => {
      const pattern = likePattern((req.query as { q: string }).q.trim());
      const [communities, places, leaders, bills, posts] = await Promise.all([
        pool.query(
          `SELECT slug, name, kind FROM communities
            WHERE kind <> 'humanity' AND name ILIKE $1 ORDER BY name LIMIT 8`,
          [pattern],
        ),
        pool.query(
          `SELECT slug, name, kind FROM places WHERE name ILIKE $1 ORDER BY kind, name LIMIT 8`,
          [pattern],
        ),
        pool.query(
          `SELECT slug, name, office, party FROM leaders
            WHERE name ILIKE $1 OR office ILIKE $1 ORDER BY name LIMIT 8`,
          [pattern],
        ),
        pool.query<BillRow>(
          `${BILL_SELECT} WHERE b.title ILIKE $2 OR b.number ILIKE $2
            ORDER BY b.last_action_at DESC LIMIT 8`,
          [viewer(req), pattern],
        ),
        pool.query(
          `SELECT p.id, p.title, c.slug AS "communitySlug", c.name AS "communityName"
             FROM posts p JOIN communities c ON c.id = p.community_id
            WHERE p.status = 'visible' AND c.kind <> 'humanity'
              AND (p.title ILIKE $1 OR p.body ILIKE $1)
            ORDER BY p.created_at DESC LIMIT 10`,
          [pattern],
        ),
      ]);
      return {
        communities: communities.rows,
        places: places.rows,
        leaders: leaders.rows,
        bills: bills.rows.map(billView),
        posts: posts.rows,
      };
    },
  );
}
