import { randomBytes } from 'node:crypto';
import type { Pool } from '@demanity/db';
import { DEV_SEED_AUDIT_ACTION } from '../../vault/src/dev-seed-guard.js';
import type { VaultService } from '../../vault/src/service.js';
import { createSession, SESSION_TTL_SECONDS } from '../src/auth/sessions.js';

/**
 * DEVELOPMENT ONLY. Creates fully active moderator accounts (dev_mod_1, dev_mod_2, …)
 * so the founder can exercise moderator features before the app's sign-in
 * screens exist.
 *
 * Demanity has no passwords: access is a bearer session token printed once.
 * Every seeded account is recorded in dev_seed_accounts (activity DB) and as a
 * dev_seed.identity audit entry (vault), and BOTH production services refuse to
 * start while any such record exists.
 */

export interface SeededModerator {
  username: string;
  token: string;
  expiresInDays: number;
  created: boolean;
}

export async function seedDevModerators(opts: {
  apiPool: Pool;
  vaultPool: Pool;
  vault: VaultService;
  count?: number;
}): Promise<SeededModerator[]> {
  // Three, so a fact-check panel can be seated (docs/MODERATION.md §4).
  const { apiPool, vaultPool, vault, count = 3 } = opts;
  const LEANS = ['left', 'center', 'right'] as const;
  const setLean = (id: string, i: number) =>
    apiPool.query(
      `INSERT INTO moderator_leans (account_id, lean) VALUES ($1, $2)
       ON CONFLICT (account_id) DO NOTHING`,
      [id, LEANS[(i - 1) % 3]],
    );
  const out: SeededModerator[] = [];
  const expiresInDays = SESSION_TTL_SECONDS.full / 86_400;

  for (let i = 1; i <= count; i++) {
    const username = `dev_mod_${i}`;
    const { rows } = await apiPool.query<{ id: string; seeded: boolean }>(
      `SELECT a.id, (s.account_id IS NOT NULL) AS seeded
         FROM accounts a LEFT JOIN dev_seed_accounts s ON s.account_id = a.id
        WHERE a.username = $1`,
      [username],
    );
    const existing = rows[0];
    if (existing && !existing.seeded) {
      throw new Error(`${username} exists but is not a seed account; refusing to touch it`);
    }
    if (existing) {
      await setLean(existing.id, i);
      out.push({
        username,
        token: await createSession(apiPool, existing.id, 'full'),
        expiresInDays,
        created: false,
      });
      continue;
    }

    const { rows: created } = await apiPool.query<{ id: string }>(
      'INSERT INTO accounts (username, webauthn_user_id) VALUES ($1, $2) RETURNING id',
      [username, randomBytes(32)],
    );
    const accountId = created[0]!.id;

    // Real vault path (fake verifier in development), clearly fake identity data.
    const { identityId } = await vault.verifyAndRegister(accountId, {
      firstName: 'Dev',
      lastName: `Moderator${i}`,
      birthDate: '1990-01-01',
      state: 'DC',
      licenseNumber: `DEVSEED${String(i).padStart(4, '0')}`,
    });
    await vaultPool.query(
      "INSERT INTO audit_log (action, identity_id, actor, reason_code) VALUES ($1, $2, 'dev_seed', 'dev_seed')",
      [DEV_SEED_AUDIT_ACTION, identityId],
    );
    // .invalid is reserved and can never receive mail (RFC 2606).
    await vault.setContact(accountId, 'email', `${username}@example.invalid`);
    await vaultPool.query(
      "UPDATE contacts SET verified_at = now() WHERE identity_id = $1 AND kind = 'email'",
      [identityId],
    );

    await apiPool.query("UPDATE accounts SET status = 'active' WHERE id = $1", [accountId]);
    await apiPool.query('INSERT INTO dev_seed_accounts (account_id) VALUES ($1)', [accountId]);
    await setLean(accountId, i);
    await apiPool.query("INSERT INTO account_roles (account_id, role) VALUES ($1, 'moderator')", [
      accountId,
    ]);
    await apiPool.query(
      `INSERT INTO moderation_log (action, target_username, reason_code, actor_role)
       VALUES ('role.moderator.granted', $1, 'dev_seed', 'operator')`,
      [username],
    );

    out.push({
      username,
      token: await createSession(apiPool, accountId, 'full'),
      expiresInDays,
      created: true,
    });
  }
  return out;
}
