import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';

/**
 * Minimal, auditable SQL migration runner.
 *
 * - Applies `NNNN_name.sql` files from `dir` in lexical order, each in its own transaction.
 * - Records each applied file with a SHA-256 checksum in `schema_migrations`.
 * - Refuses to run if an already-applied file was modified (tamper/drift detection).
 * - Serializes concurrent runners with a Postgres advisory lock.
 */

const LOCK_KEY = 72_616_201; // arbitrary constant, unique to this runner
const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export async function migrate(pool: pg.Pool, dir: string): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (!FILE_PATTERN.test(file)) {
      throw new Error(`Invalid migration file name: ${file} (expected NNNN_name.sql)`);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.id, r.checksum]));

    const result: MigrationResult = { applied: [], skipped: [] };
    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      const sum = checksum(sql);
      const previous = applied.get(file);

      if (previous !== undefined) {
        if (previous !== sum) {
          throw new Error(`Migration ${file} was modified after being applied (checksum mismatch)`);
        }
        result.skipped.push(file);
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [
          file,
          sum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      result.applied.push(file);
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
