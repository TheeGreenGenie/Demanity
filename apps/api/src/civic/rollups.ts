import type { Pool, PoolClient } from '@demanity/db';
import { TRUST_V1, trustScore, wilsonLowerBound, type TrustCitation } from './trust.js';

/**
 * Precomputes everything derived from civic data, so requests never redo the
 * math (docs/adr/0007-precomputed-civic-data.md):
 *   1. each place's peer group (same kind + similar population),
 *   2. which category scores apply (by level of government),
 *   3. per-category peer rank, peer count and peer average,
 *   4. overall scores and their peer rank,
 *   5. quality-of-life peer medians and the "monthly basics" cost figure,
 * then bumps `data_version` so response caches refresh.
 *
 * Run it after any data load (ingestion jobs, the dev seed). It is a handful
 * of set-based SQL statements plus one pass in memory over the score rows.
 */

/** Level of government for each kind of place or office. */
export const PLACE_LEVEL: Record<string, string> = {
  nation: 'federal',
  congressional_district: 'federal',
  state: 'state',
  county: 'local',
  city: 'local',
  court_district: 'judicial',
};
export const OFFICE_LEVEL: Record<string, string> = {
  president: 'federal',
  us_senate: 'federal',
  us_house: 'federal',
  governor: 'state',
  state_senate: 'state',
  state_house: 'state',
  mayor: 'local',
  county_executive: 'local',
};

/** Population bands for similar-size comparison (cities and counties only). */
export const SIZE_BANDS: Array<{ key: string; min: number; label: string }> = [
  { key: 'major', min: 1_000_000, label: '1M+ people' },
  { key: 'large', min: 250_000, label: '250k–1M people' },
  { key: 'mid', min: 50_000, label: '50k–250k people' },
  { key: 'small', min: 0, label: 'under 50k people' },
];
/** A band with fewer members than this falls back to all places of that kind. */
export const MIN_PEERS = 3;

export const OVERALL_MIN_EVIDENCE = 3;
/** Assumed gasoline use for the monthly-basics figure (an assumption, not data). */
export const GALLONS_PER_MONTH = 40;

const bandOf = (population: number | null) =>
  population === null ? null : SIZE_BANDS.find((b) => population >= b.min)!.key;

/** Evidence-weighted mean (docs/SCORING.md §4.1). */
export function overallOf(rows: Array<{ score: number; n: number }>) {
  let num = 0;
  let den = 0;
  let counted = 0;
  let excluded = 0;
  for (const { score, n } of rows) {
    if (n < OVERALL_MIN_EVIDENCE) {
      excluded++;
      continue;
    }
    const e = 1 - Math.exp(-n / 10);
    num += e * score;
    den += e;
    counted++;
  }
  return { score: den > 0 ? Math.round(num / den) : null, counted, excluded };
}

/**
 * Leader trust scores from accepted citations (docs/SCORING.md §2-§3).
 * Writes one category_scores row per leader and category that has accepted
 * citations. A real score replaces any sample row for that leader/category.
 */
async function recomputeTrust(client: PoolClient, now: Date): Promise<void> {
  const { rows } = await client.query<{
    id: string;
    leader_id: string;
    category_id: string;
    category_name: string;
    direction: 'positive' | 'negative';
    action_date: Date;
    trust_at_add: string | null;
    accurate_yes: number;
    accurate_no: number;
    weight: string;
    claim: string;
    source_url: string;
  }>(
    `SELECT c.id, c.leader_id, c.category_id, cat.name AS category_name, c.direction, c.action_date,
            c.trust_at_add, c.accurate_yes, c.accurate_no, s.weight, c.claim, c.source_url
       FROM citations c
       JOIN approved_sources s ON s.domain = c.source_domain
       JOIN communities cat ON cat.id = c.category_id
      WHERE c.status = 'accepted'`,
  );
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.leader_id}|${r.category_id}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  // Leaders who lost all accepted citations in a category lose that real score.
  await client.query(
    `DELETE FROM category_scores cs
      WHERE cs.subject_type = 'leader' AND cs.method_version = $1
        AND NOT EXISTS (SELECT 1 FROM citations c WHERE c.status = 'accepted'
                         AND c.leader_id = cs.subject_id AND c.category_id = cs.category_id)`,
    [TRUST_V1.methodVersion],
  );
  const asOf = now.toISOString().slice(0, 10);
  for (const list of groups.values()) {
    const first = list[0]!;
    const input: TrustCitation[] = list.map((r) => ({
      id: r.id,
      direction: r.direction,
      actionDate: r.action_date,
      trustAtAdd: r.trust_at_add === null ? 0.5 : Number(r.trust_at_add),
      accurateYes: r.accurate_yes,
      accurateNo: r.accurate_no,
      sourceWeight: Number(r.weight),
    }));
    const result = trustScore(input, now);
    const byId = new Map(list.map((r) => [r.id, r]));
    const evidence = [...result.contributions]
      .sort((a, b) => Math.abs(b.x) - Math.abs(a.x))
      .slice(0, 5)
      .map((c) => {
        const r = byId.get(c.id)!;
        const votes = r.accurate_yes + r.accurate_no;
        const pct = votes ? Math.round((r.accurate_yes / votes) * 100) : 0;
        return {
          label: `${r.direction === 'positive' ? 'Positive' : 'Negative'}: ${r.claim} (rated accurate by ${pct}% of ${votes}${c.gated ? '; waiting on streak' : ''})`,
          url: r.source_url,
        };
      });
    const score = Math.round(result.score);
    const rationale =
      `Based on ${result.counted} counted citation${result.counted === 1 ? '' : 's'} ` +
      `(${result.positives} positive, ${result.negatives} negative) in ${first.category_name}. ` +
      'Each citation is weighted by how accurate members rated it (Wilson lower bound) and by source quality; ' +
      'older citations fade, failures where the leader was trusted weigh more, and positives count only after a streak.' +
      (result.pendingStreak
        ? ` Streak ${result.pendingStreak.have}/${result.pendingStreak.need}: newest positives not yet counted.`
        : '') +
      (result.counted < TRUST_V1.lowEvidenceBelow
        ? ' Low evidence: treat as a first impression.'
        : '');
    await client.query(
      `INSERT INTO category_scores (subject_type, subject_id, category_id, score, rationale, evidence,
                                    evidence_count, method_version, as_of, is_sample)
       VALUES ('leader', $1, $2, $3, $4, $5, $6, $7, $8, false)
       ON CONFLICT (subject_type, subject_id, category_id) DO UPDATE
         SET score = EXCLUDED.score, rationale = EXCLUDED.rationale, evidence = EXCLUDED.evidence,
             evidence_count = EXCLUDED.evidence_count, method_version = EXCLUDED.method_version,
             as_of = EXCLUDED.as_of, is_sample = false`,
      [
        first.leader_id,
        first.category_id,
        Math.min(100, Math.max(0, score)),
        rationale,
        JSON.stringify(evidence),
        result.counted,
        TRUST_V1.methodVersion,
        asOf,
      ],
    );
  }
}

export { wilsonLowerBound };

export async function recomputeRollups(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ version: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Peer groups for places.
    const { rows: places } = await client.query<{
      id: string;
      kind: string;
      population: number | null;
    }>('SELECT id, kind, population FROM places');
    const counts = new Map<string, number>();
    const wanted = places.map((p) => {
      const band = p.kind === 'city' || p.kind === 'county' ? bandOf(p.population) : null;
      const group = band ? `${p.kind}:${band}` : p.kind;
      counts.set(group, (counts.get(group) ?? 0) + 1);
      return { id: p.id, kind: p.kind, group };
    });
    await client.query(
      `UPDATE places p SET peer_group = v.g FROM unnest($1::uuid[], $2::text[]) AS v(id, g) WHERE p.id = v.id`,
      [
        wanted.map((p) => p.id),
        wanted.map((p) => ((counts.get(p.group) ?? 0) >= MIN_PEERS ? p.group : p.kind)),
      ],
    );

    // Subjects with their peer group and level of government.
    const subjects = `
      SELECT 'place'::text AS subject_type, p.id AS subject_id, p.peer_group,
             CASE p.kind ${Object.entries(PLACE_LEVEL)
               .map(([k, v]) => `WHEN '${k}' THEN '${v}'`)
               .join(' ')} END AS level
        FROM places p
      UNION ALL
      SELECT 'leader', l.id, 'leader:' || l.office_kind,
             CASE l.office_kind ${Object.entries(OFFICE_LEVEL)
               .map(([k, v]) => `WHEN '${k}' THEN '${v}'`)
               .join(' ')} END
        FROM leaders l`;

    // 1b. Leader trust scores from accepted citations.
    await recomputeTrust(client, now);

    // 2. Applicability.
    await client.query(
      `UPDATE category_scores cs SET applicable = EXISTS (
         SELECT 1 FROM (${subjects}) s JOIN category_levels cl ON cl.level = s.level
          WHERE s.subject_type = cs.subject_type AND s.subject_id = cs.subject_id
            AND cl.category_id = cs.category_id)`,
    );

    // 3. Per-category peer stats (applicable scores only).
    await client.query(
      `UPDATE category_scores SET peer_rank = NULL, peer_count = NULL, peer_avg = NULL`,
    );
    await client.query(
      `UPDATE category_scores cs SET peer_rank = r.rank, peer_count = r.cnt, peer_avg = r.avg
         FROM (SELECT x.subject_type, x.subject_id, x.category_id,
                      rank() OVER w AS rank, count(*) OVER w AS cnt, round(avg(x.score) OVER w) AS avg
                 FROM category_scores x
                 JOIN (${subjects}) s ON s.subject_type = x.subject_type AND s.subject_id = x.subject_id
                WHERE x.applicable
               WINDOW w AS (PARTITION BY s.peer_group, x.category_id ORDER BY x.score DESC
                            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)) r
        WHERE cs.subject_type = r.subject_type AND cs.subject_id = r.subject_id
          AND cs.category_id = r.category_id`,
    );

    // 4. Overall scores and their rank within the peer group.
    const { rows: subjectRows } = await client.query<{
      subject_type: string;
      subject_id: string;
      peer_group: string;
    }>(`SELECT subject_type, subject_id, peer_group FROM (${subjects}) s`);
    const { rows: scoreRows } = await client.query<{
      subject_type: string;
      subject_id: string;
      score: number;
      n: number;
    }>(
      `SELECT subject_type, subject_id, score, evidence_count AS n FROM category_scores WHERE applicable`,
    );
    const bySubject = new Map<string, Array<{ score: number; n: number }>>();
    for (const r of scoreRows) {
      const k = `${r.subject_type}:${r.subject_id}`;
      const list = bySubject.get(k);
      if (list) list.push(r);
      else bySubject.set(k, [r]);
    }
    const computed = subjectRows.map((s) => ({
      ...s,
      ...overallOf(bySubject.get(`${s.subject_type}:${s.subject_id}`) ?? []),
    }));
    await client.query('DELETE FROM score_rollups');
    // Rank within each peer group in O(n log n): sort once, then the rank of a
    // score is 1 + the number of strictly higher scores in its group.
    const groups = new Map<string, number[]>();
    for (const c of computed) {
      if (c.score === null) continue;
      const list = groups.get(c.peer_group);
      if (list) list.push(c.score);
      else groups.set(c.peer_group, [c.score]);
    }
    const rankOf = new Map<string, Map<number, number>>();
    for (const [g, scores] of groups) {
      scores.sort((a, b) => b - a);
      const m = new Map<number, number>();
      scores.forEach((v, i) => !m.has(v) && m.set(v, i + 1));
      rankOf.set(g, m);
    }
    const ranked = computed.map((c) => ({
      ...c,
      rank: c.score === null ? null : rankOf.get(c.peer_group)!.get(c.score)!,
      peerCount: c.score === null ? null : groups.get(c.peer_group)!.length,
    }));
    await client.query(
      `INSERT INTO score_rollups (subject_type, subject_id, peer_group, overall, categories_counted,
                                  categories_excluded, peer_rank, peer_count)
       SELECT * FROM unnest($1::text[], $2::uuid[], $3::text[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[])`,
      [
        ranked.map((r) => r.subject_type),
        ranked.map((r) => r.subject_id),
        ranked.map((r) => r.peer_group),
        ranked.map((r) => r.score),
        ranked.map((r) => r.counted),
        ranked.map((r) => r.excluded),
        ranked.map((r) => r.rank),
        ranked.map((r) => r.peerCount),
      ],
    );

    // 5. Quality-of-life peer medians and monthly basics.
    await client.query(
      `UPDATE place_stats s SET peer_median = m.med, peer_count = m.n
         FROM (SELECT st.key, p.peer_group,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY st.value) AS med, count(*)::int AS n
                 FROM place_stats st JOIN places p ON p.id = st.place_id
                GROUP BY st.key, p.peer_group) m, places p
        WHERE p.id = s.place_id AND m.key = s.key AND m.peer_group = p.peer_group`,
    );
    await client.query('DELETE FROM place_cost_rollups');
    await client.query(
      `INSERT INTO place_cost_rollups (place_id, basics_monthly, real_income)
       SELECT p.id,
              round(max(v.value) FILTER (WHERE v.key = 'median_rent')
                  + max(v.value) FILTER (WHERE v.key = 'groceries')
                  + max(v.value) FILTER (WHERE v.key = 'electric_bill')
                  + max(v.value) FILTER (WHERE v.key = 'gas_price') * $1),
              round(max(v.value) FILTER (WHERE v.key = 'median_income')
                  / NULLIF(max(v.value) FILTER (WHERE v.key = 'cost_of_living') / 100, 0))
         FROM places p JOIN place_stats v ON v.place_id = p.id
        GROUP BY p.id
       HAVING count(*) FILTER (WHERE v.key IN ('median_rent', 'groceries', 'electric_bill', 'gas_price')) = 4`,
      [GALLONS_PER_MONTH],
    );
    await client.query(
      `UPDATE place_cost_rollups c SET basics_peer_median = m.med, basics_peer_count = m.n
         FROM (SELECT p.peer_group, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY c2.basics_monthly)) AS med,
                      count(*)::int AS n
                 FROM place_cost_rollups c2 JOIN places p ON p.id = c2.place_id GROUP BY p.peer_group) m,
              places p
        WHERE p.id = c.place_id AND m.peer_group = p.peer_group`,
    );

    const { rows } = await client.query<{ version: string }>(
      'UPDATE data_version SET version = version + 1, dirty = false RETURNING version',
    );
    await client.query('COMMIT');
    return { version: Number(rows[0]!.version) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Human label for a peer group, e.g. "cities with 1M+ people". */
export function peerLabel(group: string): string {
  const plural: Record<string, string> = {
    nation: 'nations',
    state: 'states',
    county: 'counties',
    city: 'cities',
    court_district: 'court districts',
    congressional_district: 'congressional districts',
    president: 'presidents',
    us_senate: 'U.S. senators',
    us_house: 'U.S. representatives',
    governor: 'governors',
    state_senate: 'state senators',
    state_house: 'state representatives',
    mayor: 'mayors',
    county_executive: 'county executives',
  };
  const [kind, band] = group.replace(/^leader:/, '').split(':');
  const base = plural[kind!] ?? 'peers';
  const b = SIZE_BANDS.find((x) => x.key === band);
  return b ? `${base} with ${b.label}` : base;
}
