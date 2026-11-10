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
