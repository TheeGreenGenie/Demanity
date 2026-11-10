import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The real vault, wired in-process so the API -> vault path is fully exercised.
import { buildVaultApp } from '../../vault/src/app.js';
import { LocalKeyProvider } from '../../vault/src/crypto/envelope.js';
import { parseKeyring } from '../../vault/src/crypto/keys.js';
import { InMemoryEmailSender } from '../../vault/src/providers/email.js';
import { EmailOtpProvider } from '../../vault/src/providers/otp.js';
import { ChannelRouter } from '../../vault/src/providers/two-factor.js';
import { FakeVerifier } from '../../vault/src/providers/verifier.js';
import { VaultService } from '../../vault/src/service.js';
import { buildApp } from '../src/app.js';
import { MemoryChallengeStore } from '../src/auth/challenges.js';
import { HttpVaultClient } from '../src/vault-client.js';
import { SoftAuthenticator } from './soft-authenticator.js';

const here = dirname(fileURLToPath(import.meta.url));
const RP = { id: 'localhost', name: 'Demanity', origins: ['http://localhost:8081'] };
const VAULT_TOKEN = randomBytes(32).toString('hex');
const relaxed = { max: 10_000, timeWindow: '1 minute' };
const RELAXED = {
  signup: relaxed,
  verification: relaxed,
  codeSend: relaxed,
  codeCheck: relaxed,
  signIn: relaxed,
};

let apiPool: Pool;
let vaultPool: Pool;
const drops: Array<() => Promise<void>> = [];
let vaultApp: FastifyInstance;
let app: FastifyInstance;
let mail: InMemoryEmailSender;

beforeAll(async () => {
  const apiDb = await createTempDatabase();
  const vaultDb = await createTempDatabase();
  drops.push(apiDb.drop, vaultDb.drop);
  apiPool = createPool(apiDb.url);
  vaultPool = createPool(vaultDb.url);
  await migrate(apiPool, join(here, '..', 'migrations'));
  await migrate(vaultPool, join(here, '..', '..', 'vault', 'migrations'));

  // Default production path: vault-generated email codes (no SMS configured).
  mail = new InMemoryEmailSender();
  const lookupKey = randomBytes(32);
  vaultApp = await buildVaultApp({
    serviceToken: VAULT_TOKEN,
    service: new VaultService({
      pool: vaultPool,
      tokenKeys: parseKeyring(`1:${randomBytes(32).toString('base64')}`, 'K'),
      lookupKey,
      keyProvider: new LocalKeyProvider(randomBytes(32)),
      verifier: new FakeVerifier(),
      twoFactor: new ChannelRouter({ email: new EmailOtpProvider(vaultPool, lookupKey, mail) }),
    }),
  });

  // fetch implementation that routes vault HTTP calls into the in-process vault app.
  const vaultFetch = (async (url: string, init: RequestInit = {}) => {
    const res = await vaultApp.inject({
      method: init.method as 'GET',
      url: new URL(url).pathname,
      headers: init.headers as Record<string, string>,
      ...(init.body ? { payload: init.body as string } : {}),
    });
    return new Response(res.body || null, { status: res.statusCode });
  }) as unknown as typeof fetch;

  app = await buildApp({
    deps: {
      pool: apiPool,
      vault: new HttpVaultClient('http://vault.internal', VAULT_TOKEN, vaultFetch),
      challenges: new MemoryChallengeStore(),
      rp: RP,
      // Generous limits: these tests exercise flows, not throttling (see rate-limit tests).
      rateLimit: { secret: randomBytes(32), routeLimits: RELAXED },
    },
  });
});

afterAll(async () => {
  await app?.close();
  await vaultApp?.close();
  await apiPool?.end();
  await vaultPool?.end();
  for (const d of drops) await d();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

let counter = 0;
const identity = () => ({
  firstName: 'Ida',
  lastName: 'Wells',
  birthDate: '1992-07-16',
  state: 'PA',
  licenseNumber: `P${(++counter).toString().padStart(7, '0')}${randomBytes(2).toString('hex')}`,
});

/** Signs up a user all the way to an active account with a passkey. */
async function onboard(username: string, email: string) {
  const created = await app.inject({ method: 'POST', url: '/v1/accounts', payload: { username } });
  expect(created.statusCode).toBe(201);
  const token = created.json().token as string;
  const auth = bearer(token);

  const verified = await app.inject({
    method: 'POST',
    url: '/v1/me/verification',
    headers: auth,
    payload: identity(),
  });
  expect(verified.json()).toEqual({ status: 'verified' });

  const sent = await app.inject({
    method: 'PUT',
    url: '/v1/me/contacts/email',
    headers: auth,
    payload: { value: email },
  });
  expect(sent.statusCode).toBe(202);
  const confirmed = await app.inject({
    method: 'POST',
    url: '/v1/me/contacts/email/confirm',
    headers: auth,
    payload: { code: mail.lastCode(email)! },
  });
  expect(confirmed.json()).toEqual({ status: 'active' });

  const device = new SoftAuthenticator(RP.id, RP.origins[0]!);
  const options = (
    await app.inject({ method: 'POST', url: '/v1/me/passkeys/options', headers: auth })
  ).json();
  const registered = await app.inject({
    method: 'POST',
    url: '/v1/me/passkeys',
    headers: auth,
    payload: { response: device.register(options) },
  });
  expect(registered.statusCode).toBe(201);
  return { token, device };
}

async function signIn(device: SoftAuthenticator) {
  const { challengeId, options } = (
    await app.inject({ method: 'POST', url: '/v1/auth/passkey/options' })
  ).json();
  return app.inject({
    method: 'POST',
    url: '/v1/auth/passkey',
    payload: { challengeId, response: device.authenticate(options) },
  });
}

describe('sign-up, verification, 2FA and passkeys', () => {
  it('runs the full flow and signs in with the passkey', async () => {
    const { device } = await onboard('ida_wells', 'ida@example.com');
    const login = await signIn(device);
    expect(login.statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: bearer(login.json().token),
    });
    expect(me.json()).toEqual({ username: 'ida_wells', status: 'active', scope: 'full' });
  });

  it('stores no identity data or contacts in the activity database', async () => {
    const tables = ['accounts', 'passkeys', 'sessions'];
    const dump = JSON.stringify(
      await Promise.all(tables.map(async (t) => (await apiPool.query(`SELECT * FROM ${t}`)).rows)),
    );
    for (const secret of ['Ida', 'Wells', '1992-07-16', 'ida@example.com']) {
      expect(dump).not.toContain(secret);
    }
  });

  it('rejects a second account for the same person', async () => {
    const person = identity();
    for (const [i, username] of ['dup_one', 'dup_two'].entries()) {
      const token = (
        await app.inject({ method: 'POST', url: '/v1/accounts', payload: { username } })
      ).json().token;
      const res = await app.inject({
        method: 'POST',
        url: '/v1/me/verification',
        headers: bearer(token),
        payload: person,
      });
      expect(res.statusCode).toBe(i === 0 ? 200 : 409);
    }
  });

  it('rejects taken usernames and malformed input', async () => {
    await app.inject({ method: 'POST', url: '/v1/accounts', payload: { username: 'taken_name' } });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/accounts',
          payload: { username: 'taken_name' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/accounts',
          payload: { username: 'Bad Name!' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('rejects replayed and forged passkey sign-ins', async () => {
    const { device } = await onboard('replay_test', 'replay@example.com');
    const { challengeId, options } = (
      await app.inject({ method: 'POST', url: '/v1/auth/passkey/options' })
    ).json();
    const response = device.authenticate(options);
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/passkey',
      payload: { challengeId, response },
    });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/passkey',
      payload: { challengeId, response },
    });
    expect(replay.json()).toEqual({ error: 'challenge_expired' });

    const stranger = new SoftAuthenticator(RP.id, RP.origins[0]!);
    expect((await signIn(stranger)).json()).toEqual({ error: 'unknown_credential' });
  });

  it('rejects passkeys from the wrong origin or without user verification', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/accounts',
      payload: { username: 'origin_test' },
    });
    const auth = bearer(created.json().token);
    await app.inject({
      method: 'POST',
      url: '/v1/me/verification',
      headers: auth,
      payload: identity(),
    });
    await app.inject({
      method: 'PUT',
      url: '/v1/me/contacts/email',
      headers: auth,
      payload: { value: 'origin@example.com' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/me/contacts/email/confirm',
      headers: auth,
      payload: { code: mail.lastCode('origin@example.com')! },
    });

    for (const device of [
      new SoftAuthenticator(RP.id, 'https://evil.example'),
      new SoftAuthenticator(RP.id, RP.origins[0]!, { userVerified: false }),
    ]) {
      const options = (
        await app.inject({ method: 'POST', url: '/v1/me/passkeys/options', headers: auth })
      ).json();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/me/passkeys',
        headers: auth,
        payload: { response: device.register(options) },
      });
      expect(res.json()).toEqual({ error: 'verification_failed' });
    }
  });
});

describe('2FA channels', () => {
  it('refuses SMS when Twilio is not configured (email is the free default)', async () => {
    const token = (
      await app.inject({ method: 'POST', url: '/v1/accounts', payload: { username: 'sms_off' } })
    ).json().token;
    await app.inject({
      method: 'POST',
      url: '/v1/me/verification',
      headers: bearer(token),
      payload: identity(),
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/me/contacts/sms',
      headers: bearer(token),
      payload: { value: '(415) 555-2671' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'channel_unavailable' });
  });
});

describe('guest mode and onboarding gates', () => {
  it('lets guests read but not write', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/v1/me/passkeys/options' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'sign_in_required' });
  });

  it('blocks passkey setup until identity and 2FA are both done', async () => {
    const token = (
      await app.inject({ method: 'POST', url: '/v1/accounts', payload: { username: 'not_ready' } })
    ).json().token;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/me/passkeys/options',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'account_not_ready', status: 'pending' });
  });

  it('rejects invalid and expired session tokens', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: bearer('garbage') })).statusCode,
    ).toBe(401);
    const token = (
      await app.inject({ method: 'POST', url: '/v1/accounts', payload: { username: 'expiring' } })
    ).json().token;
    await apiPool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) })).statusCode,
    ).toBe(401);
  });
});

describe('lost-device recovery', () => {
  it('replaces the old passkey after a 2FA-verified recovery', async () => {
    const { device: oldPhone } = await onboard('lost_phone', 'lost@example.com');

    const start = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery/start',
      payload: { username: 'lost_phone', channel: 'email' },
    });
    expect(start.statusCode).toBe(202);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery/verify',
      payload: { username: 'lost_phone', channel: 'email', code: '000000' },
    });
    expect(bad.statusCode).toBe(400);
    await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery/start',
      payload: { username: 'lost_phone', channel: 'email' },
    });
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery/verify',
      payload: {
        username: 'lost_phone',
        channel: 'email',
        code: mail.lastCode('lost@example.com')!,
      },
    });
    const recovery = bearer(ok.json().token);

    const newPhone = new SoftAuthenticator(RP.id, RP.origins[0]!);
    const options = (
      await app.inject({ method: 'POST', url: '/v1/me/passkeys/options', headers: recovery })
    ).json();
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/me/passkeys',
      headers: recovery,
      payload: { response: newPhone.register(options) },
    });
    expect(reg.statusCode).toBe(201);

    expect((await signIn(newPhone)).statusCode).toBe(200);
    expect((await signIn(oldPhone)).json()).toEqual({ error: 'unknown_credential' }); // revoked
    // The recovery session is single-use.
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: recovery })).statusCode).toBe(
      401,
    );
  });

  it('does not reveal whether a username exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery/start',
      payload: { username: 'nobody_here', channel: 'email' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'if_account_exists_code_sent' });
  });
});
