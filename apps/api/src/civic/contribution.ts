import type { PoolClient } from '@demanity/db';
import { wilsonLowerBound } from './trust.js';

/**
 * Contribution score (docs/SCORING.md §5, REVIEW BEFORE RELEASE):
 *
 *   CS = Σ_citations [0.8 × WilsonLB(accurate) + 0.2 × WilsonLB(approve)]
 *      + Σ_perspectives WilsonLB(helpful)
 *      − 3 × takedowns − 1 × citations that needed a context note
 *
 * Only accepted citations count toward the first sum. Takedowns are removed
 * citations and removed perspectives. Falling below the threshold revokes
 * every contributor grant the account holds; the revocation is publicly logged.
 */
export const CONTRIBUTION_V1 = {
  accurateWeight: 0.8,
  approveWeight: 0.2,
  takedownPenalty: 3,
  notePenalty: 1,
  /** Revoke when the score is strictly below this (config, REVIEW BEFORE RELEASE). */
  revokeBelow: Number(process.env.CONTRIBUTOR_MIN_SCORE ?? -3),
} as const;

export interface ContributionInputs {
  citations: Array<{
    accurateYes: number;
    accurateNo: number;
    approveYes: number;
    approveNo: number;
  }>;
  perspectives: Array<{ helpfulYes: number; helpfulNo: number }>;
  takedowns: number;
  noted: number;
}

export function contributionScore(i: ContributionInputs, p = CONTRIBUTION_V1): number {
  let s = 0;
  for (const c of i.citations)
    s +=
      p.accurateWeight * wilsonLowerBound(c.accurateYes, c.accurateYes + c.accurateNo) +
      p.approveWeight * wilsonLowerBound(c.approveYes, c.approveYes + c.approveNo);
  for (const d of i.perspectives) s += wilsonLowerBound(d.helpfulYes, d.helpfulYes + d.helpfulNo);
  return s - p.takedownPenalty * i.takedowns - p.notePenalty * i.noted;
}

/** Recomputes every contributor's score and revokes grants below the threshold. */
export async function recomputeContributionScores(
  client: PoolClient,
  p = CONTRIBUTION_V1,
): Promise<{ revoked: string[] }> {
  const { rows } = await client.query<{
    account_id: string;
    citations: Array<{ ay: number; an: number; py: number; pn: number }> | null;
    perspectives: Array<{ hy: number; hn: number }> | null;
    takedowns: number;
    noted: number;
  }>(
    `WITH people AS (
       SELECT submitted_by AS id FROM citations WHERE submitted_by IS NOT NULL
       UNION SELECT author_id FROM citation_perspectives WHERE author_id IS NOT NULL
       UNION SELECT account_id FROM contributor_grants
     )
     SELECT p.id AS account_id,
       (SELECT json_agg(json_build_object('ay', accurate_yes, 'an', accurate_no, 'py', approve_yes, 'pn', approve_no))
          FROM citations WHERE submitted_by = p.id AND status = 'accepted') AS citations,
       (SELECT json_agg(json_build_object('hy', helpful_yes, 'hn', helpful_no))
          FROM citation_perspectives WHERE author_id = p.id AND status = 'visible') AS perspectives,
       ((SELECT count(*) FROM citations WHERE submitted_by = p.id AND status = 'removed')
        + (SELECT count(*) FROM citation_perspectives WHERE author_id = p.id AND status = 'removed'))::int AS takedowns,
       (SELECT count(DISTINCT c.id) FROM citations c
          JOIN context_notes n ON n.target_type = 'citation' AND n.target_id = c.id AND n.status = 'visible'
         WHERE c.submitted_by = p.id)::int AS noted
     FROM people p`,
  );
  const revoked: string[] = [];
  for (const r of rows) {
    const inputs: ContributionInputs = {
      citations: (r.citations ?? []).map((c) => ({
        accurateYes: c.ay,
        accurateNo: c.an,
        approveYes: c.py,
        approveNo: c.pn,
      })),
      perspectives: (r.perspectives ?? []).map((d) => ({ helpfulYes: d.hy, helpfulNo: d.hn })),
      takedowns: r.takedowns,
      noted: r.noted,
    };
    const score = contributionScore(inputs, p);
    await client.query(
      `INSERT INTO contribution_scores (account_id, score, citations, perspectives, takedowns, noted, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (account_id) DO UPDATE SET score = EXCLUDED.score, citations = EXCLUDED.citations,
         perspectives = EXCLUDED.perspectives, takedowns = EXCLUDED.takedowns, noted = EXCLUDED.noted,
         computed_at = now()`,
      [
        r.account_id,
        score,
        inputs.citations.length,
        inputs.perspectives.length,
        r.takedowns,
        r.noted,
      ],
    );
    if (score < p.revokeBelow) {
      const { rowCount } = await client.query(
        'DELETE FROM contributor_grants WHERE account_id = $1',
        [r.account_id],
      );
      if (rowCount) {
        revoked.push(r.account_id);
        // Automatic, so the actor is the system, not a moderator.
        await client.query(
          `INSERT INTO moderation_log (action, reason_code, actor_role, actor_account_id)
           VALUES ('contributor.revoked_automatically', 'contribution_score_low', 'system', NULL)`,
        );
      }
    }
  }
  return { revoked };
}
