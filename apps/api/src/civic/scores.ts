import type { Pool } from '@demanity/db';

/**
 * 0-100 category scores for places and leaders, with peer comparison.
 *
 * Peers: places are compared only with places of the same kind (cities with
 * cities, states with states, districts with districts); leaders only with
 * leaders holding the same kind of office.
 *
 * Overall score (docs/SCORING.md §4.1, REVIEW BEFORE RELEASE): an
 * evidence-weighted mean of category scores,
 *   overall = Σ e_c·score_c / Σ e_c,  e_c = 1 − exp(−n_c / 10),
 * where n_c is the number of evidence items behind category c. Categories
 * with n_c < 3 are left out (and listed as "not enough evidence").
 */

export type SubjectType = 'place' | 'leader';

export interface CategoryScore {
  category: { slug: string; name: string };
  score: number | null; // null = not scored yet
  rationale: string | null;
  evidence: Array<{ label: string; url: string | null }>;
  evidenceCount: number;
  lowEvidence: boolean;
  methodVersion: string | null;
  asOf: string | null;
  isSample: boolean;
  peers: { rank: number; count: number; average: number } | null;
}

export interface Overall {
  score: number | null;
  categoriesCounted: number;
  categoriesExcluded: number;
  peers: { rank: number; count: number } | null;
  method: string;
}

export const OVERALL_METHOD =
  'Evidence-weighted mean of category scores (categories with fewer than 3 evidence items excluded). Proposal under review.';
const MIN_EVIDENCE = 3;

/** SQL that yields (subject_id) for every peer of a subject, including itself. */
function peerSql(type: SubjectType): string {
  return type === 'place'
    ? `SELECT p.id FROM places p WHERE p.kind = (SELECT kind FROM places WHERE id = $1)`
    : `SELECT l.id FROM leaders l WHERE l.office_kind = (SELECT office_kind FROM leaders WHERE id = $1)`;
}

export async function categoryScores(
  pool: Pool,
  type: SubjectType,
  subjectId: string,
): Promise<CategoryScore[]> {
  const { rows } = await pool.query<{
    slug: string;
    name: string;
    score: number | null;
    rationale: string | null;
    evidence: Array<{ label: string; url: string | null }> | null;
    evidence_count: number | null;
    method_version: string | null;
    as_of: Date | null;
    is_sample: boolean | null;
    rank: string | null;
    peer_count: string | null;
    peer_avg: string | null;
  }>(
    `WITH peers AS (
       SELECT cs.category_id, cs.subject_id,
              rank() OVER (PARTITION BY cs.category_id ORDER BY cs.score DESC) AS rank,
              count(*) OVER (PARTITION BY cs.category_id) AS peer_count,
              round(avg(cs.score) OVER (PARTITION BY cs.category_id)) AS peer_avg
         FROM category_scores cs
        WHERE cs.subject_type = $2 AND cs.subject_id IN (${peerSql(type)})
     )
     SELECT c.slug, c.name, s.score, s.rationale, s.evidence, s.evidence_count,
            s.method_version, s.as_of, s.is_sample, pr.rank, pr.peer_count, pr.peer_avg
       FROM communities c
       LEFT JOIN category_scores s
              ON s.category_id = c.id AND s.subject_type = $2 AND s.subject_id = $1
       LEFT JOIN peers pr ON pr.category_id = c.id AND pr.subject_id = $1
      WHERE c.kind = 'topic'
      ORDER BY c.name`,
    [subjectId, type],
  );
  return rows.map((r) => ({
    category: { slug: r.slug, name: r.name },
    score: r.score,
    rationale: r.rationale,
    evidence: r.evidence ?? [],
    evidenceCount: r.evidence_count ?? 0,
    lowEvidence: r.score !== null && (r.evidence_count ?? 0) < MIN_EVIDENCE,
    methodVersion: r.method_version,
    asOf: r.as_of ? r.as_of.toISOString().slice(0, 10) : null,
    isSample: r.is_sample ?? false,
    peers:
      r.rank !== null
        ? { rank: Number(r.rank), count: Number(r.peer_count), average: Number(r.peer_avg) }
        : null,
  }));
}

function overallOf(rows: Array<{ score: number; n: number }>) {
  let num = 0;
  let den = 0;
  let counted = 0;
  let excluded = 0;
  for (const { score, n } of rows) {
    if (n < MIN_EVIDENCE) {
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

/** Overall scores for many subjects at once (keyed by subject id). */
export async function overallScores(
  pool: Pool,
  type: SubjectType,
  ids: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return out;
  const { rows } = await pool.query<{ subject_id: string; score: number; n: number }>(
    `SELECT subject_id, score, evidence_count AS n FROM category_scores
      WHERE subject_type = $1 AND subject_id = ANY($2::uuid[])`,
    [type, ids],
  );
  const grouped = new Map<string, Array<{ score: number; n: number }>>();
  for (const r of rows) grouped.set(r.subject_id, [...(grouped.get(r.subject_id) ?? []), r]);
  for (const [id, list] of grouped) out.set(id, overallOf(list).score);
  return out;
}

/** Overall score for one subject plus its rank among peers. */
export async function overallWithRank(
  pool: Pool,
  type: SubjectType,
  subjectId: string,
): Promise<Overall> {
  const { rows } = await pool.query<{ subject_id: string; score: number; n: number }>(
    `SELECT cs.subject_id, cs.score, cs.evidence_count AS n FROM category_scores cs
      WHERE cs.subject_type = $2 AND cs.subject_id IN (${peerSql(type)})`,
    [subjectId, type],
  );
  const grouped = new Map<string, Array<{ score: number; n: number }>>();
  for (const r of rows) grouped.set(r.subject_id, [...(grouped.get(r.subject_id) ?? []), r]);
  const mine = overallOf(grouped.get(subjectId) ?? []);
  let peers: Overall['peers'] = null;
  if (mine.score !== null) {
    const all = [...grouped.values()]
      .map((list) => overallOf(list).score)
      .filter((s): s is number => s !== null);
    peers = { rank: all.filter((s) => s > mine.score!).length + 1, count: all.length };
  }
  return {
    score: mine.score,
    categoriesCounted: mine.counted,
    categoriesExcluded: mine.excluded,
    peers,
    method: OVERALL_METHOD,
  };
}
