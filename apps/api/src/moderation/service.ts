import type { Pool } from '@demanity/db';

export async function isModerator(pool: Pool, accountId: string): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT 1 FROM account_roles WHERE account_id = $1 AND role = 'moderator'",
    [accountId],
  );
  return rows.length > 0;
}

export async function logAction(
  pool: Pool,
  entry: { action: string; reasonCode: string; actorAccountId: string; targetUsername?: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO moderation_log (action, target_username, reason_code, actor_role, actor_account_id)
     VALUES ($1, $2, $3, 'moderator', $4)`,
    [entry.action, entry.targetUsername ?? null, entry.reasonCode, entry.actorAccountId],
  );
}

export type SecondModeratorResult =
  | { state: 'confirmed' }
  | { state: 'proposed' }
  | { state: 'awaiting_second_moderator' }
  | { state: 'reason_mismatch'; proposedReason: string };

/**
 * Two-moderator rule (R10). The first moderator's call records a proposal;
 * the action happens only when a DIFFERENT moderator confirms it with the
 * same reason code. Proposals older than 7 days no longer count.
 */
export async function secondModerator(
  pool: Pool,
  kind: 'ban' | 'verification_deny',
  targetId: string,
  reasonCode: string,
  actorAccountId: string,
): Promise<SecondModeratorResult> {
  await pool.query("DELETE FROM moderation_proposals WHERE created_at < now() - interval '7 days'");
  const { rows } = await pool.query<{ reason_code: string; proposed_by: string }>(
    'SELECT reason_code, proposed_by FROM moderation_proposals WHERE kind = $1 AND target_id = $2',
    [kind, targetId],
  );
  const existing = rows[0];
  if (!existing) {
    await pool.query(
      'INSERT INTO moderation_proposals (kind, target_id, reason_code, proposed_by) VALUES ($1, $2, $3, $4)',
      [kind, targetId, reasonCode, actorAccountId],
    );
    return { state: 'proposed' };
  }
  if (existing.proposed_by === actorAccountId) return { state: 'awaiting_second_moderator' };
  if (existing.reason_code !== reasonCode)
    return { state: 'reason_mismatch', proposedReason: existing.reason_code };
  await pool.query('DELETE FROM moderation_proposals WHERE kind = $1 AND target_id = $2', [
    kind,
    targetId,
  ]);
  return { state: 'confirmed' };
}

/** Replies for the non-confirmed states, shared by the routes that use the rule. */
export function secondModeratorReply(r: SecondModeratorResult) {
  if (r.state === 'proposed') return { code: 202, body: { status: 'pending_second_moderator' } };
  if (r.state === 'awaiting_second_moderator')
    return { code: 409, body: { error: 'awaiting_second_moderator' } };
  if (r.state === 'reason_mismatch')
    return {
      code: 409,
      body: { error: 'reason_mismatch_with_proposal', proposedReason: r.proposedReason },
    };
  return null;
}

/** Deletes `pending` accounts older than `maxAgeHours`, freeing reserved usernames. */
export async function deleteStalePendingAccounts(pool: Pool, maxAgeHours = 24): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM accounts
      WHERE status = 'pending'
        AND created_at < now() - make_interval(hours => $1)
        AND NOT EXISTS (SELECT 1 FROM verification_reviews r WHERE r.account_id = accounts.id)`,
    [maxAgeHours],
  );
  return rowCount ?? 0;
}
