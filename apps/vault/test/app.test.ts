import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildVaultApp, serializeRequest } from '../src/app.js';
import { LocalKeyProvider } from '../src/crypto/envelope.js';
import { parseKeyring } from '../src/crypto/keys.js';
import { InMemoryTwoFactorProvider } from '../src/providers/two-factor.js';
import { FakeVerifier } from '../src/providers/verifier.js';
import { VaultService } from '../src/service.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const TOKEN = randomBytes(32).toString('hex');
const auth = { authorization: `Bearer ${TOKEN}` };

let pool: Pool;
let drop: () => Promise<void>;
let app: FastifyInstance;
const logLines: string[] = [];

beforeAll(async () => {
  const db = await createTempDatabase();
  drop = db.drop;
  pool = createPool(db.url);
  await migrate(pool, MIGRATIONS);
  const service = new VaultService({
    pool,
    tokenKeys: parseKeyring(`1:${randomBytes(32).toString('base64')}`, 'KEYS'),
    lookupKey: randomBytes(32),
    keyProvider: new LocalKeyProvider(randomBytes(32)),
    verifier: new FakeVerifier(),
    twoFactor: new InMemoryTwoFactorProvider(),
  });
  const stream = new Writable({
    write(chunk, _e, cb) {
      logLines.push(chunk.toString());
      cb();
    },
  });
  app = await buildVaultApp({
    service,
    serviceToken: TOKEN,
    logger: { level: 'info', stream, serializers: { req: serializeRequest } },
  });
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await drop();
});

const body = (overrides: Record<string, unknown> = {}) => ({
  accountId: randomUUID(),
  firstName: 'Grace',
  lastName: 'Hopper',
  birthDate: '1985-12-09',
  state: 'NY',
  licenseNumber: `N${randomBytes(3).toString('hex').toUpperCase()}`,
  ...overrides,
});

describe('vault HTTP API', () => {
  it('requires the service token on every route except /health', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/v1/identities/verify', payload: body() });
    expect(res.statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/identities/verify',
      headers: { authorization: `Bearer ${'x'.repeat(TOKEN.length)}` },
      payload: body(),
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('runs the full sign-up, contact and 2FA flow', async () => {
    const b = body();
    const v = await app.inject({
      method: 'POST',
      url: '/v1/identities/verify',
      headers: auth,
      payload: b,
    });
    expect(v.statusCode).toBe(201);
    expect(v.json().status).toBe('verified');

    const dup = await app.inject({
      method: 'POST',
      url: '/v1/identities/verify',
      headers: auth,
      payload: { ...b, accountId: randomUUID() },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: 'duplicate_identity' });

    const base = `/v1/accounts/${b.accountId}`;
    const set = await app.inject({
      method: 'PUT',
      url: `${base}/contacts/email`,
      headers: auth,
      payload: { value: 'grace@example.com' },
    });
    expect(set.statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'POST', url: `${base}/2fa/email/start`, headers: auth }))
        .statusCode,
    ).toBe(202);
    const check = await app.inject({
      method: 'POST',
      url: `${base}/2fa/email/check`,
      headers: auth,
      payload: { code: '123456' },
    });
    expect(check.json()).toEqual({ approved: true });
  });

  it('maps errors to codes without leaking details', async () => {
    const minor = await app.inject({
      method: 'POST',
      url: '/v1/identities/verify',
      headers: auth,
      payload: body({ birthDate: '2015-01-01' }),
    });
    expect(minor.statusCode).toBe(422);
    expect(minor.json()).toEqual({ error: 'under_18' });

    const badState = await app.inject({
      method: 'POST',
      url: '/v1/identities/verify',
      headers: auth,
      payload: body({ state: 'ZZ' }),
    });
    expect(badState.statusCode).toBe(400);

    const extra = await app.inject({
      method: 'POST',
      url: '/v1/identities/verify',
      headers: auth,
      payload: { ...body(), ssn: '123-45-6789' },
    });
    expect(extra.statusCode).toBe(400); // unknown fields are rejected, never stored
  });

  it('never writes identity attributes or contacts to logs', async () => {
    const b = body({ licenseNumber: 'LOGTEST99' });
    await app.inject({ method: 'POST', url: '/v1/identities/verify', headers: auth, payload: b });
    await app.inject({
      method: 'PUT',
      url: `/v1/accounts/${b.accountId}/contacts/email`,
      headers: auth,
      payload: { value: 'logtest@example.com' },
    });
    const out = logLines.join('\n');
    expect(out).toContain('/v1/identities/verify');
    for (const secret of [
      'LOGTEST99',
      'Grace',
      'Hopper',
      '1985-12-09',
      'logtest@example.com',
      TOKEN,
    ]) {
      expect(out).not.toContain(secret);
    }
  });
});
