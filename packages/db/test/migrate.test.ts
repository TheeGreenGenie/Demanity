import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, migrate, type Pool } from '../src/index.js';
import { createTempDatabase } from '../src/testing.js';

let pool: Pool;
let drop: () => Promise<void>;
let dir: string;

// One database per file (creating/dropping a database per test is slow under
// parallel load); each test starts from an empty public schema instead.
beforeAll(async () => {
  const db = await createTempDatabase();
  drop = db.drop;
  pool = createPool(db.url);
});

beforeEach(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  dir = await mkdtemp(join(tmpdir(), 'migrations-'));
});

afterAll(async () => {
  await pool?.end();
  await drop?.();
});

describe('migrate', () => {
  it('applies files in order and records them', async () => {
    await writeFile(join(dir, '0001_create_a.sql'), 'CREATE TABLE a (id int);');
    await writeFile(join(dir, '0002_create_b.sql'), 'CREATE TABLE b (id int);');

    const result = await migrate(pool, dir);
    expect(result).toEqual({ applied: ['0001_create_a.sql', '0002_create_b.sql'], skipped: [] });

    const { rows } = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual(['0001_create_a.sql', '0002_create_b.sql']);
  });

  it('is idempotent', async () => {
    await writeFile(join(dir, '0001_create_a.sql'), 'CREATE TABLE a (id int);');
    await migrate(pool, dir);
    const second = await migrate(pool, dir);
    expect(second).toEqual({ applied: [], skipped: ['0001_create_a.sql'] });
  });

  it('rejects a modified, already-applied migration', async () => {
    const file = join(dir, '0001_create_a.sql');
    await writeFile(file, 'CREATE TABLE a (id int);');
    await migrate(pool, dir);
    await writeFile(file, 'CREATE TABLE a (id int, sneaky text);');
    await expect(migrate(pool, dir)).rejects.toThrow(/checksum mismatch/);
  });

  it('rolls back a failing migration entirely', async () => {
    await writeFile(
      join(dir, '0001_bad.sql'),
      'CREATE TABLE half (id int); SELECT * FROM does_not_exist;',
    );
    await expect(migrate(pool, dir)).rejects.toThrow(/0001_bad\.sql failed/);

    const { rows } = await pool.query("SELECT to_regclass('public.half') AS t");
    expect(rows[0].t).toBeNull();
    const recorded = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    expect(recorded.rows[0].n).toBe(0);
  });

  it('rejects badly named files', async () => {
    await writeFile(join(dir, 'create.sql'), 'SELECT 1;');
    await expect(migrate(pool, dir)).rejects.toThrow(/Invalid migration file name/);
  });
});
