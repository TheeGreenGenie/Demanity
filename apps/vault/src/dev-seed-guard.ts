import type { Pool } from '@demanity/db';

/** Audit action written for identities created by the development seed command. */
export const DEV_SEED_AUDIT_ACTION = 'dev_seed.identity';

/**
 * Production safety: refuse to start if the vault contains identities created
 * by the development seed command. Production must use a fresh vault database.
 */
export async function assertNoDevSeedIdentities(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit_log WHERE action = $1',
    [DEV_SEED_AUDIT_ACTION],
  );
  const n = rows[0]?.n ?? 0;
  if (n > 0) {
    throw new Error(
      `Refusing to start in production: the vault contains ${n} development seed identit(ies). ` +
        'Use a fresh production vault database.',
    );
  }
}
