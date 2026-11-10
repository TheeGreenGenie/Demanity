import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'grant-moderator.mjs');

let pool: Pool;
let url: string;
let drop: () => Promise<void>;

beforeAll(async () => {
  const db = await createTempDatabase();
  url = db.url;
  drop = db.drop;
  pool = createPool(url);
  await migrate(pool, join(here, '..', 'migrations'));
});

afterAll(async () => {
  await pool?.end();
  await drop?.();
});

const run = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, ACTIVITY_DATABASE_URL: url },
    encoding: 'utf8',
  });

async function account(username: string, status: string) {
  await pool.query(
    'INSERT INTO accounts (username, status, webauthn_user_id) VALUES ($1, $2, $3)',
    [username, status, randomBytes(32)],
  );
}

const roles = async (username: string) =>
  (
    await pool.query(
      'SELECT role FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.username = $1',
      [username],
    )
  ).rows;

describe('grant-moderator operator script', () => {
  it('refuses accounts that are not fully active', async () => {
    await account('half_done', 'verified');
    const r = run('grant', 'half_done');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Only active/);
    expect(await roles('half_done')).toEqual([]);
  });

  it('grants and revokes, logging each real change publicly', async () => {
    await account('new_mod', 'active');
    expect(run('grant', 'new_mod').stdout).toMatch(/granted moderator role/);
    expect(run('grant', 'new_mod').stdout).toMatch(/No change needed/); // idempotent, not re-logged
    expect(await roles('new_mod')).toEqual([{ role: 'moderator' }]);
    expect(run('revoke', 'new_mod').stdout).toMatch(/revoked moderator role/);
    expect(await roles('new_mod')).toEqual([]);

    const { rows } = await pool.query(
      "SELECT action, actor_role FROM moderation_log WHERE target_username = 'new_mod' ORDER BY id",
    );
    expect(rows).toEqual([
      { action: 'role.moderator.granted', actor_role: 'operator' },
      { action: 'role.moderator.revoked', actor_role: 'operator' },
    ]);
  });

  it('rejects bad arguments and unknown users', () => {
    expect(run('promote', 'x').status).toBe(2);
    expect(run('grant', 'Bad Name').status).toBe(2);
    const r = run('grant', 'nobody_here');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/No account named/);
  });
});
