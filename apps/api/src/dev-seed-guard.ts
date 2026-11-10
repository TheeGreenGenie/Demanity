import type { Pool } from '@demanity/db';

/**
 * Production safety: refuse to start if any development seed accounts exist
 * (e.g. the dev moderator accounts). Delete them, or start from a fresh
 * production database, before going live.
 */
export async function assertNoDevSeedData(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM dev_seed_accounts',
  );
  const n = rows[0]?.n ?? 0;
  if (n > 0) {
    throw new Error(
      `Refusing to start in production: ${n} development seed account(s) exist. ` +
        'Delete them (DELETE FROM accounts WHERE id IN (SELECT account_id FROM dev_seed_accounts)) ' +
        'or use a fresh production database.',
    );
  }
}
