import type { Pool } from '@demanity/db';
import { OFFICE_LEVEL, PLACE_LEVEL, peerLabel } from './rollups.js';

/**
 * Reads 0-100 category scores and overall scores. Everything here is a plain
 * lookup of values precomputed by `recomputeRollups` (no ranking or averaging
 * at request time).
 *
 * Places get a "conditions" score (how things are for residents); leaders get
 * a "trust" score (their record against their stated positions). A subject is
 * scored only in categories that apply to its level of government.
 */

export type SubjectType = 'place' | 'leader';

export interface CategoryScore {
  category: { slug: string; name: string };
  applicable: boolean;
  score: number | null; // null = not scored (no data yet, or not applicable)
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
  kind: 'conditions' | 'trust';
  score: number | null;
  categoriesCounted: number;
  categoriesExcluded: number;
  peers: { rank: number; count: number } | null;
  peerGroup: string;
  peerLabel: string;
  method: string;
}

export const OVERALL_METHOD =
  'Evidence-weighted mean of the categories that apply (categories with fewer than 3 evidence items are left out). Proposal under public review.';

export async function subjectLevel(
  pool: Pool,
  type: SubjectType,
  subjectId: string,
): Promise<string> {
  const { rows } = await pool.query<{ k: string }>(
    type === 'place'
      ? 'SELECT kind AS k FROM places WHERE id = $1'
      : 'SELECT office_kind AS k FROM leaders WHERE id = $1',
    [subjectId],
  );
  const k = rows[0]?.k ?? '';
  return (type === 'place' ? PLACE_LEVEL[k] : OFFICE_LEVEL[k]) ?? 'federal';
}

export async function categoryScores(
  pool: Pool,
  type: SubjectType,
  subjectId: string,
): Promise<CategoryScore[]> {
  const level = await subjectLevel(pool, type, subjectId);
  const { rows } = await pool.query<{
    slug: string;
    name: string;
    applicable: boolean;
    score: number | null;
    rationale: string | null;
    evidence: Array<{ label: string; url: string | null }> | null;
    evidence_count: number | null;
    method_version: string | null;
    as_of: Date | null;
    is_sample: boolean | null;
    peer_rank: number | null;
    peer_count: number | null;
    peer_avg: number | null;
  }>(
    `SELECT c.slug, c.name,
            EXISTS (SELECT 1 FROM category_levels cl WHERE cl.category_id = c.id AND cl.level = $3) AS applicable,
            s.score, s.rationale, s.evidence, s.evidence_count, s.method_version, s.as_of, s.is_sample,
            s.peer_rank, s.peer_count, s.peer_avg
       FROM communities c
       LEFT JOIN category_scores s
              ON s.category_id = c.id AND s.subject_type = $2 AND s.subject_id = $1
      WHERE c.kind = 'topic'
      ORDER BY c.name`,
    [subjectId, type, level],
  );
  return rows.map((r) => {
    // A stored score in a category that doesn't apply is never shown.
    const scored = r.applicable && r.score !== null;
    return {
      category: { slug: r.slug, name: r.name },
      applicable: r.applicable,
      score: scored ? r.score : null,
      rationale: scored ? r.rationale : null,
      evidence: scored ? (r.evidence ?? []) : [],
      evidenceCount: scored ? (r.evidence_count ?? 0) : 0,
      lowEvidence: scored && (r.evidence_count ?? 0) < 3,
      methodVersion: scored ? r.method_version : null,
      asOf: scored && r.as_of ? r.as_of.toISOString().slice(0, 10) : null,
      isSample: r.is_sample ?? false,
      peers:
        scored && r.peer_rank !== null
          ? { rank: r.peer_rank, count: r.peer_count!, average: r.peer_avg! }
          : null,
    };
  });
}

export async function overall(pool: Pool, type: SubjectType, subjectId: string): Promise<Overall> {
  const { rows } = await pool.query<{
    peer_group: string;
    overall: number | null;
    categories_counted: number;
    categories_excluded: number;
    peer_rank: number | null;
    peer_count: number | null;
  }>(
    `SELECT peer_group, overall, categories_counted, categories_excluded, peer_rank, peer_count
       FROM score_rollups WHERE subject_type = $1 AND subject_id = $2`,
    [type, subjectId],
  );
  const r = rows[0];
  const group = r?.peer_group ?? '';
  return {
    kind: type === 'place' ? 'conditions' : 'trust',
    score: r?.overall ?? null,
    categoriesCounted: r?.categories_counted ?? 0,
    categoriesExcluded: r?.categories_excluded ?? 0,
    peers: r && r.peer_rank !== null ? { rank: r.peer_rank, count: r.peer_count! } : null,
    peerGroup: group,
    peerLabel: group ? peerLabel(group) : '',
    method: OVERALL_METHOD,
  };
}

/** Overall scores for many subjects (one indexed lookup). */
export async function overallScores(
  pool: Pool,
  type: SubjectType,
  ids: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return out;
  const { rows } = await pool.query<{ subject_id: string; overall: number | null }>(
    'SELECT subject_id, overall FROM score_rollups WHERE subject_type = $1 AND subject_id = ANY($2::uuid[])',
    [type, ids],
  );
  for (const r of rows) out.set(r.subject_id, r.overall);
  return out;
}
