import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { categoryScores, overallScores, overallWithRank } from '../civic/scores.js';
import type { RouteLimits } from '../rate-limit.js';

/**
 * Civic pages (R12, R13, R17, R23, R32): places, leaders, bills, bill stances,
 * leader requests, Humanity guides and search. Guests can read everything;
 * weighing in requires a fully onboarded member.
 */

const member = requireSession({ scopes: ['full'], statuses: ['active'] });
const uuid = { type: 'string', format: 'uuid' } as const;
const slugParam = {
  type: 'object',
  properties: { slug: { type: 'string', pattern: '^[a-z0-9-]{2,80}$' } },
} as const;
const idParam = { type: 'object', properties: { id: uuid } } as const;

const viewer = (req: FastifyRequest) => req.session?.accountId ?? null;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface BillView {
  id: string;
  number: string;
  title: string;
  summary: string;
  status: string;
  introducedAt: string;
  lastActionAt: string;
  sourceUrl: string | null;
  isSample: boolean;
  place: { slug: string; name: string };
  category: { slug: string; name: string } | null;
  sponsors: Array<{ slug: string; name: string; party: string; role: string }>;
  bipartisan: boolean;
  weighedIn: boolean;
  /** Only shown after the viewer has weighed in, to avoid bandwagon effects. */
  tally: { support: number; oppose: number } | null;
}

const BILL_SELECT = `
  SELECT b.id, b.number, b.title, b.summary, b.status, b.introduced_at, b.last_action_at,
         b.source_url, b.is_sample, p.slug AS place_slug, p.name AS place_name,
         c.slug AS category_slug, c.name AS category_name,
         COALESCE((SELECT json_agg(json_build_object('slug', l.slug, 'name', l.name, 'party', l.party, 'role', s.role)
                                   ORDER BY s.role DESC, l.name)
                     FROM bill_sponsors s JOIN leaders l ON l.id = s.leader_id WHERE s.bill_id = b.id), '[]') AS sponsors,
         (SELECT count(DISTINCT l.party) FROM bill_sponsors s JOIN leaders l ON l.id = s.leader_id
           WHERE s.bill_id = b.id AND l.party <> '') AS parties,
         EXISTS (SELECT 1 FROM bill_swipes w WHERE w.bill_id = b.id AND w.account_id = $1) AS weighed_in,
         t.support, t.oppose
    FROM bills b
    JOIN places p ON p.id = b.place_id
    LEFT JOIN communities c ON c.id = b.category_id
    LEFT JOIN bill_tallies t ON t.bill_id = b.id`;

interface BillRow {
  id: string;
  number: string;
  title: string;
  summary: string;
  status: string;
  introduced_at: Date;
  last_action_at: Date;
  source_url: string | null;
  is_sample: boolean;
  place_slug: string;
  place_name: string;
  category_slug: string | null;
  category_name: string | null;
  sponsors: BillView['sponsors'];
  parties: string;
  weighed_in: boolean;
  support: number | null;
  oppose: number | null;
}

function billView(r: BillRow): BillView {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    summary: r.summary,
    status: r.status,
    introducedAt: day(r.introduced_at)!,
    lastActionAt: day(r.last_action_at)!,
    sourceUrl: r.source_url,
    isSample: r.is_sample,
    place: { slug: r.place_slug, name: r.place_name },
    category: r.category_slug ? { slug: r.category_slug, name: r.category_name! } : null,
    sponsors: r.sponsors,
    bipartisan: Number(r.parties) >= 2,
    weighedIn: r.weighed_in,
    tally: r.weighed_in ? { support: r.support ?? 0, oppose: r.oppose ?? 0 } : null,
  };
}

/** Escapes LIKE wildcards so search input is matched literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export async function civicRoutes(app: FastifyInstance, deps: { pool: Pool; limits: RouteLimits }) {
  const { pool, limits } = deps;
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

  async function placeBySlug(slug: string) {
    const { rows } = await pool.query<{
      id: string;
      slug: string;
      name: string;
      kind: string;
      is_sample: boolean;
      parent_slug: string | null;
      parent_name: string | null;
      community_slug: string | null;
    }>(
      `SELECT p.id, p.slug, p.name, p.kind, p.is_sample, pp.slug AS parent_slug, pp.name AS parent_name,
              c.slug AS community_slug
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
      place_slug: string | null;
      place_name: string | null;
    }>(
      `SELECT l.id, l.slug, l.name, l.office, l.office_kind, l.party, l.in_office, l.bio, l.is_sample,
              p.slug AS place_slug, p.name AS place_name
         FROM leaders l LEFT JOIN places p ON p.id = l.place_id WHERE l.slug = $1`,
      [slug],
    );
    return rows[0] ?? null;
  }

  async function leadersAt(placeIds: string[]) {
    const { rows } = await pool.query<{
      id: string;
      slug: string;
      name: string;
      office: string;
      party: string;
      is_sample: boolean;
    }>(
      `SELECT id, slug, name, office, party, is_sample FROM leaders
        WHERE place_id = ANY($1::uuid[]) AND in_office
        ORDER BY array_position(ARRAY['president','governor','us_senate','us_house','mayor','county_executive','state_senate','state_house'], office_kind), name`,
      [placeIds],
    );
    const overall = await overallScores(
      pool,
      'leader',
      rows.map((r) => r.id),
    );
    return rows.map(({ id, is_sample, ...l }) => ({
      ...l,
      isSample: is_sample,
      overall: overall.get(id) ?? null,
    }));
  }

  // --- Places --------------------------------------------------------------------

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
    async (req) => {
      const { kind } = req.query as { kind?: string };
      const { rows } = await pool.query(
        `SELECT p.slug, p.name, p.kind, pp.name AS "parentName" FROM places p
           LEFT JOIN places pp ON pp.id = p.parent_id
          WHERE ($1::text IS NULL OR p.kind = $1) ORDER BY p.kind, p.name`,
        [kind ?? null],
      );
      return { places: rows };
    },
  );

  app.get('/v1/places/:slug', { schema: { params: slugParam } }, async (req, reply) => {
    const place = await placeBySlug((req.params as { slug: string }).slug);
    if (!place) return notFound(reply);

    const [children, issues, elections, stats, bills, overall] = await Promise.all([
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
        `SELECT office, kind, election_date, source_label AS "sourceLabel", source_url AS "sourceUrl",
                is_sample AS "isSample"
           FROM elections WHERE place_id = $1 AND election_date >= CURRENT_DATE
          ORDER BY election_date LIMIT 10`,
        [place.id],
      ),
      pool.query<{ peer_median: number | null; value: string }>(
        `SELECT s.key, s.label, s.value, s.unit, s.higher_is_better AS "higherIsBetter",
                s.source_label AS "sourceLabel", s.source_url AS "sourceUrl", s.as_of AS "asOf",
                s.is_sample AS "isSample",
                (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s2.value)
                   FROM place_stats s2 JOIN places p2 ON p2.id = s2.place_id
                  WHERE s2.key = s.key AND p2.kind = $2) AS peer_median,
                (SELECT count(*)::int FROM place_stats s2 JOIN places p2 ON p2.id = s2.place_id
                  WHERE s2.key = s.key AND p2.kind = $2) AS "peerCount"
           FROM place_stats s WHERE s.place_id = $1
          ORDER BY array_position(ARRAY['cost_of_living','median_income','median_rent','groceries','childcare','gas_price','electric_bill','unemployment','uninsured','commute'], s.key), s.label`,
        [place.id, place.kind],
      ),
      pool.query<BillRow>(
        `${BILL_SELECT} WHERE b.place_id = $2 ORDER BY b.last_action_at DESC, b.id DESC LIMIT 5`,
        [viewer(req), place.id],
      ),
      overallWithRank(pool, 'place', place.id),
    ]);

    return {
      slug: place.slug,
      name: place.name,
      kind: place.kind,
      isSample: place.is_sample,
      parent: place.parent_slug ? { slug: place.parent_slug, name: place.parent_name } : null,
      community: place.community_slug,
      children: children.rows,
      overall,
      issues: issues.rows,
      elections: elections.rows.map((e) => ({ ...e, electionDate: day(e.election_date) })),
      leaders: await leadersAt([place.id]),
      stats: stats.rows.map(({ peer_median, value, ...s }) => ({
        ...s,
        value: Number(value),
        peerMedian: peer_median === null ? null : Number(peer_median),
        asOf: day((s as unknown as { asOf: Date }).asOf),
      })),
      recentBills: bills.rows.map(billView),
    };
  });

  app.get('/v1/places/:slug/scores', { schema: { params: slugParam } }, async (req, reply) => {
    const place = await placeBySlug((req.params as { slug: string }).slug);
    if (!place) return notFound(reply);
    return {
      peerGroup: place.kind,
      overall: await overallWithRank(pool, 'place', place.id),
      categories: await categoryScores(pool, 'place', place.id),
    };
  });

  // --- Leaders -------------------------------------------------------------------

  app.get('/v1/leaders/:slug', { schema: { params: slugParam } }, async (req, reply) => {
    const l = await leaderBySlug((req.params as { slug: string }).slug);
    if (!l) return notFound(reply);
    const sponsored = await pool.query<BillRow>(
      `${BILL_SELECT} JOIN bill_sponsors bs ON bs.bill_id = b.id AND bs.leader_id = $2
        ORDER BY (b.status IN ('passed', 'signed')) DESC, b.last_action_at DESC, b.id DESC LIMIT 20`,
      [viewer(req), l.id],
    );
    const bills = sponsored.rows.map(billView);
    return {
      slug: l.slug,
      name: l.name,
      office: l.office,
      officeKind: l.office_kind,
      party: l.party,
      inOffice: l.in_office,
      bio: l.bio,
      isSample: l.is_sample,
      place: l.place_slug ? { slug: l.place_slug, name: l.place_name } : null,
      overall: await overallWithRank(pool, 'leader', l.id),
      passed: bills.filter((b) => b.status === 'passed' || b.status === 'signed'),
      sponsored: bills.filter((b) => b.status !== 'passed' && b.status !== 'signed'),
    };
  });

  app.get('/v1/leaders/:slug/scores', { schema: { params: slugParam } }, async (req, reply) => {
    const l = await leaderBySlug((req.params as { slug: string }).slug);
    if (!l) return notFound(reply);
    return {
      peerGroup: l.office_kind,
      overall: await overallWithRank(pool, 'leader', l.id),
      categories: await categoryScores(pool, 'leader', l.id),
    };
  });

  // --- Leader requests: what members most want a leader to do ---------------------

  app.get('/v1/leaders/:slug/requests', { schema: { params: slugParam } }, async (req, reply) => {
    const l = await leaderBySlug((req.params as { slug: string }).slug);
    if (!l) return notFound(reply);
    const { rows } = await pool.query(
      `SELECT r.id, r.title, r.body, r.created_at AS "createdAt", a.username,
                (SELECT count(*)::int FROM leader_request_votes v WHERE v.request_id = r.id) AS votes,
                EXISTS (SELECT 1 FROM leader_request_votes v WHERE v.request_id = r.id AND v.account_id = $2) AS "myVote"
           FROM leader_requests r LEFT JOIN accounts a ON a.id = r.author_id
          WHERE r.leader_id = $1 AND r.status = 'open'
          ORDER BY votes DESC, r.created_at DESC LIMIT 100`,
      [l.id, viewer(req)],
    );
    return {
      requests: rows.map(({ username, ...r }) => ({
        ...r,
        author: username ? { username } : null,
      })),
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
      // The author supports their own request.
      await pool.query(
        'INSERT INTO leader_request_votes (account_id, request_id) VALUES ($1, $2)',
        [req.session!.accountId, rows[0]!.id],
      );
      return reply.code(201).send({ id: rows[0]!.id });
    },
  );

  app.put(
    '/v1/leader-requests/:id/vote',
    { preHandler: member, schema: { params: idParam } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { rowCount } = await pool.query(
        "SELECT 1 FROM leader_requests WHERE id = $1 AND status = 'open'",
        [id],
      );
      if (!rowCount) return notFound(reply);
      await pool.query(
        'INSERT INTO leader_request_votes (account_id, request_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.session!.accountId, id],
      );
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

  // --- Bills and private stances ---------------------------------------------------

  app.get(
    '/v1/bills',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            place: { type: 'string', pattern: '^[a-z0-9-]{2,80}$' },
            category: { type: 'string', pattern: '^[a-z0-9-]{2,60}$' },
            bipartisan: { type: 'boolean' },
          },
        },
      },
    },
    async (req) => {
      const { place, category, bipartisan } = req.query as {
        place?: string;
        category?: string;
        bipartisan?: boolean;
      };
      const { rows } = await pool.query<BillRow>(
        `SELECT * FROM (${BILL_SELECT}
          WHERE ($2::text IS NULL OR p.slug = $2) AND ($3::text IS NULL OR c.slug = $3)) x
          WHERE (NOT $4::boolean OR x.parties >= 2)
          ORDER BY x.last_action_at DESC, x.id DESC LIMIT 50`,
        [viewer(req), place ?? null, category ?? null, bipartisan ?? false],
      );
      return { bills: rows.map(billView) };
    },
  );

  /** Bills the member hasn't weighed in on yet (the swipe deck). */
  app.get('/v1/bills/deck', { preHandler: member }, async (req) => {
    const { rows } = await pool.query<BillRow>(
      `${BILL_SELECT}
        WHERE NOT EXISTS (SELECT 1 FROM bill_swipes w WHERE w.bill_id = b.id AND w.account_id = $1)
          AND b.status NOT IN ('failed', 'vetoed')
        ORDER BY b.last_action_at DESC, b.id DESC LIMIT 25`,
      [req.session!.accountId],
    );
    return { bills: rows.map(billView) };
  });

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

  // --- Humanity guides ---------------------------------------------------------------

  app.get('/v1/guides', async () => {
    const { rows } = await pool.query(
      `SELECT slug, topic, title, summary, reading_minutes AS "readingMinutes" FROM guides
        ORDER BY array_position(ARRAY['civics','voting','cost-of-living','media-literacy','community'], topic), title`,
    );
    return { guides: rows };
  });

  app.get('/v1/guides/:slug', { schema: { params: slugParam } }, async (req, reply) => {
    const { rows } = await pool.query<{ updated_at: Date }>(
      `SELECT slug, topic, title, summary, body, sources, reading_minutes AS "readingMinutes", updated_at
         FROM guides WHERE slug = $1`,
      [(req.params as { slug: string }).slug],
    );
    if (!rows[0]) return notFound(reply);
    const { updated_at, ...g } = rows[0];
    return { ...g, updatedAt: day(updated_at) };
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
