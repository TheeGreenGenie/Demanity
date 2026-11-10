import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalKeyProvider } from '../src/crypto/envelope.js';
import { parseKeyring } from '../src/crypto/keys.js';
import { InMemoryTwoFactorProvider } from '../src/providers/two-factor.js';
import { FakeVerifier, type VerificationRequest } from '../src/providers/verifier.js';
import { VaultService } from '../src/service.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const NOW = new Date('2026-11-09T12:00:00Z');

let pool: Pool;
let drop: () => Promise<void>;
let twoFactor: InMemoryTwoFactorProvider;
let vault: VaultService;
const tokenKey = randomBytes(32).toString('base64');

const person = (overrides: Partial<VerificationRequest> = {}): VerificationRequest => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  birthDate: '1990-05-01',
  state: 'CA',
  licenseNumber: `D${randomBytes(4).readUInt32BE() % 10_000_000}`.padEnd(8, '0'),
  ...overrides,
});

beforeAll(async () => {
  const db = await createTempDatabase();
  drop = db.drop;
  pool = createPool(db.url);
  await migrate(pool, MIGRATIONS);
});

afterAll(async () => {
  await pool?.end();
  await drop?.();
});

beforeEach(() => {
  twoFactor = new InMemoryTwoFactorProvider();
  vault = new VaultService({
    pool,
    tokenKeys: parseKeyring(`1:${tokenKey}`, 'KEYS'),
    lookupKey: randomBytes(32),
    keyProvider: new LocalKeyProvider(randomBytes(32)),
    verifier: new FakeVerifier(() => NOW),
    twoFactor,
    now: () => NOW,
  });
});

describe('verifyAndRegister', () => {
  it('registers a new adult and stores no raw attributes', async () => {
    const p = person({ licenseNumber: 'D7654321' });
    const { identityId } = await vault.verifyAndRegister(randomUUID(), p);
    expect(identityId).toMatch(/^[0-9a-f-]{36}$/);

    const dump = JSON.stringify((await pool.query('SELECT * FROM identities')).rows);
    for (const secret of ['D7654321', 'Ada', 'Lovelace', '1990-05-01']) {
      expect(dump).not.toContain(secret);
    }
  });

  it('blocks a second account for the same person, even with different formatting', async () => {
    await vault.verifyAndRegister(randomUUID(), person({ licenseNumber: 'Z1112223' }));
    await expect(
      vault.verifyAndRegister(randomUUID(), person({ licenseNumber: 'z111-2223', state: 'ca' })),
    ).rejects.toMatchObject({ code: 'duplicate_identity' });
  });

  it('rejects under-18 applicants before calling the provider', async () => {
    await expect(
      vault.verifyAndRegister(randomUUID(), person({ birthDate: '2009-01-01' })),
    ).rejects.toMatchObject({ code: 'under_18' });
  });

  it('accepts someone whose 18th birthday is today, rejects someone a day short', async () => {
    await expect(
      vault.verifyAndRegister(randomUUID(), person({ birthDate: '2008-11-09' })),
    ).resolves.toHaveProperty('identityId');
    await expect(
      vault.verifyAndRegister(randomUUID(), person({ birthDate: '2008-11-10' })),
    ).rejects.toMatchObject({ code: 'under_18' });
  });

  it('maps provider rejection and review outcomes', async () => {
    await expect(
      vault.verifyAndRegister(randomUUID(), person({ licenseNumber: 'REJECT01' })),
    ).rejects.toMatchObject({ code: 'not_verified' });
    await expect(
      vault.verifyAndRegister(randomUUID(), person({ licenseNumber: 'REVIEW01' })),
    ).rejects.toMatchObject({ code: 'needs_review' });
  });

  it('keeps banned people out permanently', async () => {
    const accountId = randomUUID();
    const p = person({ licenseNumber: 'B9998887' });
    await vault.verifyAndRegister(accountId, p);
    await vault.ban(accountId, 'moderator', 'account_sale');
    await expect(vault.verifyAndRegister(randomUUID(), p)).rejects.toMatchObject({
      code: 'banned',
    });
  });

  it('still detects duplicates after the token key is rotated', async () => {
    const p = person({ licenseNumber: 'R1234567' });
    await vault.verifyAndRegister(randomUUID(), p);
    const rotated = new VaultService({
      pool,
      tokenKeys: parseKeyring(`1:${tokenKey},2:${randomBytes(32).toString('base64')}`, 'KEYS'),
      lookupKey: randomBytes(32),
      keyProvider: new LocalKeyProvider(randomBytes(32)),
      verifier: new FakeVerifier(() => NOW),
      twoFactor,
      now: () => NOW,
    });
    await expect(rotated.verifyAndRegister(randomUUID(), p)).rejects.toMatchObject({
      code: 'duplicate_identity',
    });
  });
});

describe('moderator override and recovery matching', () => {
  it('lets a moderator approve a needs-review case, without bypassing safety checks', async () => {
    const review = person({ licenseNumber: 'REVIEW77' });
    await expect(vault.verifyAndRegister(randomUUID(), review)).rejects.toMatchObject({
      code: 'needs_review',
    });
    const override = { reasonCode: 'manual_document_review' };
    await expect(vault.verifyAndRegister(randomUUID(), review, override)).resolves.toHaveProperty(
      'identityId',
    );
    // Duplicates, minors and banned people are still refused under an override.
    await expect(vault.verifyAndRegister(randomUUID(), review, override)).rejects.toMatchObject({
      code: 'duplicate_identity',
    });
    await expect(
      vault.verifyAndRegister(randomUUID(), person({ birthDate: '2012-01-01' }), override),
    ).rejects.toMatchObject({ code: 'under_18' });

    const { rows } = await pool.query(
      "SELECT reason_code FROM audit_log WHERE action = 'identity.created.override'",
    );
    expect(rows.map((r) => r.reason_code)).toContain('manual_document_review');
  });

  it('matches identity attributes only to the account they belong to', async () => {
    const mine = randomUUID();
    const theirs = randomUUID();
    const me = person({ licenseNumber: 'M5550001' });
    await vault.verifyAndRegister(mine, me);
    await vault.verifyAndRegister(theirs, person({ licenseNumber: 'M5550002' }));

    expect(await vault.matchesAccount(mine, { state: 'ca', licenseNumber: 'm555-0001' })).toBe(
      true,
    );
    expect(await vault.matchesAccount(theirs, me)).toBe(false); // someone else's identity
    expect(await vault.matchesAccount(randomUUID(), me)).toBe(false); // unknown account

    await vault.ban(mine, 'moderator', 'account_sale');
    expect(await vault.matchesAccount(mine, me)).toBe(false); // banned identities can't recover
  });
});

describe('contacts and 2FA', () => {
  it('stores contacts encrypted and sends codes to the decrypted value', async () => {
    const accountId = randomUUID();
    await vault.verifyAndRegister(accountId, person());
    await vault.setContact(accountId, 'email', 'Voter@Example.com');

    const dump = JSON.stringify((await pool.query('SELECT * FROM contacts')).rows);
    expect(dump.toLowerCase()).not.toContain('voter@example.com');

    await vault.startTwoFactor(accountId, 'email');
    expect(twoFactor.sent.get('voter@example.com')?.channel).toBe('email');

    expect(await vault.hasVerifiedContact(accountId)).toBe(false);
    expect(await vault.checkTwoFactor(accountId, 'email', '000000')).toBe(false);
    expect(await vault.checkTwoFactor(accountId, 'email', '123456')).toBe(true);
    expect(await vault.hasVerifiedContact(accountId)).toBe(true);
  });

  it('normalizes US phone numbers and rejects foreign ones', async () => {
    const accountId = randomUUID();
    await vault.verifyAndRegister(accountId, person());
    await vault.setContact(accountId, 'sms', '(415) 555-2671');
    await vault.startTwoFactor(accountId, 'sms');
    expect(twoFactor.sent.has('+14155552671')).toBe(true);
    await expect(vault.setContact(accountId, 'sms', '+44 20 7946 0958')).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('refuses to reuse one email across two people', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await vault.verifyAndRegister(a, person());
    await vault.verifyAndRegister(b, person());
    await vault.setContact(a, 'email', 'shared@example.com');
    await expect(vault.setContact(b, 'email', 'shared@example.com')).rejects.toMatchObject({
      code: 'contact_in_use',
    });
  });

  it('errors for unknown accounts and missing contacts', async () => {
    await expect(vault.startTwoFactor(randomUUID(), 'email')).rejects.toMatchObject({
      code: 'unknown_account',
    });
    const accountId = randomUUID();
    await vault.verifyAndRegister(accountId, person());
    await expect(vault.startTwoFactor(accountId, 'sms')).rejects.toMatchObject({
      code: 'no_contact',
    });
  });
});

describe('audit log', () => {
  it('is append-only', async () => {
    await vault.verifyAndRegister(randomUUID(), person());
    await expect(pool.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
    await expect(pool.query("UPDATE audit_log SET actor = 'x'")).rejects.toThrow(/append-only/);
  });
});
