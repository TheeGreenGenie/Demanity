import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertNoDevSeedIdentities } from '../../vault/src/dev-seed-guard.js';
import { LocalKeyProvider } from '../../vault/src/crypto/envelope.js';
import { parseKeyring } from '../../vault/src/crypto/keys.js';
import { InMemoryEmailSender } from '../../vault/src/providers/email.js';
import { EmailOtpProvider } from '../../vault/src/providers/otp.js';
import { ChannelRouter } from '../../vault/src/providers/two-factor.js';
import { FakeVerifier } from '../../vault/src/providers/verifier.js';
import { VaultService } from '../../vault/src/service.js';
import { seedDevModerators } from '../dev/seed-moderators.js';
import { assertNoDevSeedData } from '../src/dev-seed-guard.js';
import { findSession } from '../src/auth/sessions.js';
import { isModerator } from '../src/moderation/service.js';

const here = dirname(fileURLToPath(import.meta.url));
let apiPool: Pool;
let vaultPool: Pool;
let vault: VaultService;
const drops: Array<() => Promise<void>> = [];

beforeAll(async () => {
  const a = await createTempDatabase();
  const v = await createTempDatabase();
  drops.push(a.drop, v.drop);
  apiPool = createPool(a.url);
  vaultPool = createPool(v.url);
  await migrate(apiPool, join(here, '..', 'migrations'));
  await migrate(vaultPool, join(here, '..', '..', 'vault', 'migrations'));
  const lookupKey = randomBytes(32);
  vault = new VaultService({
    pool: vaultPool,
    tokenKeys: parseKeyring(`1:${randomBytes(32).toString('base64')}`, 'K'),
    lookupKey,
    keyProvider: new LocalKeyProvider(randomBytes(32)),
    verifier: new FakeVerifier(),
    twoFactor: new ChannelRouter({
      email: new EmailOtpProvider(vaultPool, lookupKey, new InMemoryEmailSender()),
    }),
  });
});

afterAll(async () => {
  await apiPool?.end();
  await vaultPool?.end();
  for (const d of drops) await d();
});

describe('dev moderator seed', () => {
  it('production guards pass on clean databases', async () => {
    await expect(assertNoDevSeedData(apiPool)).resolves.toBeUndefined();
    await expect(assertNoDevSeedIdentities(vaultPool)).resolves.toBeUndefined();
  });

  it('creates two active moderators with working full sessions', async () => {
    const seeded = await seedDevModerators({ apiPool, vaultPool, vault });
    expect(seeded.map((s) => [s.username, s.created])).toEqual([
      ['dev_mod_1', true],
      ['dev_mod_2', true],
    ]);
    for (const s of seeded) {
      const session = await findSession(apiPool, s.token);
      expect(session).toMatchObject({ username: s.username, status: 'active', scope: 'full' });
      expect(await isModerator(apiPool, session!.accountId)).toBe(true);
      expect(await vault.hasVerifiedContact(session!.accountId)).toBe(true);
    }
  });

  it('is idempotent: re-running issues new tokens without duplicating accounts', async () => {
    const again = await seedDevModerators({ apiPool, vaultPool, vault });
    expect(again.every((s) => !s.created)).toBe(true);
    const { rows } = await apiPool.query(
      "SELECT count(*)::int AS n FROM accounts WHERE username LIKE 'dev_mod_%'",
    );
    expect(rows[0].n).toBe(2);
  });

  it('makes BOTH production services refuse to start while seed data exists', async () => {
    await expect(assertNoDevSeedData(apiPool)).rejects.toThrow(
      /Refusing to start in production: 2/,
    );
    await expect(assertNoDevSeedIdentities(vaultPool)).rejects.toThrow(
      /Refusing to start in production/,
    );
  });

  it('never takes over a real account with a seed username', async () => {
    await apiPool.query(
      "INSERT INTO accounts (username, webauthn_user_id) VALUES ('dev_mod_3', $1)",
      [randomBytes(32)],
    );
    await expect(seedDevModerators({ apiPool, vaultPool, vault, count: 3 })).rejects.toThrow(
      /not a seed account/,
    );
  });

  it('deleting the seed accounts clears the API guard', async () => {
    await apiPool.query(
      'DELETE FROM accounts WHERE id IN (SELECT account_id FROM dev_seed_accounts)',
    );
    await expect(assertNoDevSeedData(apiPool)).resolves.toBeUndefined();
  });
});
