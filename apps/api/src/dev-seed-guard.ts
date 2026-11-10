import type { Pool } from '@demanity/db';

/** Tables that may hold illustrative (made-up) data, marked with `is_sample`. */
export const SAMPLE_TABLES = [
  'places',
  'leaders',
  'category_scores',
  'place_stats',
  'place_issues',
  'elections',
  'bills',
  'guides',
] as const;

/**
 * Production safety: refuse to start while any development data exists:
 * dev seed accounts (e.g. the dev moderators), "[Sample]" posts, or sample
 * civic rows (made-up scores, statistics, leaders and bills). Delete them, or
 * start from a fresh production database, before going live.
 */
export async function assertNoDevSeedData(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM dev_seed_accounts',
  );
  const n = rows[0]?.n ?? 0;
  if (n > 0) {
    throw new Error(
      `Refusing to start in production: ${n} development seed account(s) exist. ` +
        'Delete their posts and comments, then the accounts (see the pre-launch checklist), ' +
        'or use a fresh production database.',
    );
  }
  const found: string[] = [];
  const { rows: posts } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM posts WHERE title LIKE '[Sample]%'",
  );
  if ((posts[0]?.n ?? 0) > 0) found.push(`posts (${posts[0]!.n})`);
  const { rows: asks } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM leader_requests WHERE title LIKE '[Sample]%'",
  );
  if ((asks[0]?.n ?? 0) > 0) found.push(`leader_requests (${asks[0]!.n})`);
  for (const table of SAMPLE_TABLES) {
    const { rows: r } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE is_sample`,
    );
    if ((r[0]?.n ?? 0) > 0) found.push(`${table} (${r[0]!.n})`);
  }
  if (found.length > 0) {
    throw new Error(
      `Refusing to start in production: sample data exists in ${found.join(', ')}. ` +
        'Run the sample-data cleanup from the pre-launch checklist, or use a fresh production database.',
    );
  }
}
