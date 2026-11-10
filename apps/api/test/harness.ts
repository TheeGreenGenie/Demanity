import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { buildVaultApp } from '../../vault/src/app.js';
import { LocalKeyProvider } from '../../vault/src/crypto/envelope.js';
import { parseKeyring } from '../../vault/src/crypto/keys.js';
import { InMemoryEmailSender } from '../../vault/src/providers/email.js';
import { EmailOtpProvider } from '../../vault/src/providers/otp.js';
import { ChannelRouter } from '../../vault/src/providers/two-factor.js';
import { FakeVerifier } from '../../vault/src/providers/verifier.js';
import { VaultService } from '../../vault/src/service.js';
import { buildApp, type AppDeps } from '../src/app.js';
import { MemoryChallengeStore } from '../src/auth/challenges.js';
import { HttpVaultClient } from '../src/vault-client.js';
import { SoftAuthenticator } from './soft-authenticator.js';

/**
 * Full in-process stack for API tests: the real API and the real vault, each
 * on its own throwaway Postgres database, with vault-generated email codes
 * captured in an in-memory outbox.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const RP = { id: 'localhost', name: 'Demanity', origins: ['http://localhost:8081'] };
const relaxed = { max: 10_000, timeWindow: '1 minute' };

export interface Harness {
  app: FastifyInstance;
  apiPool: Pool;
  mail: InMemoryEmailSender;
  close(): Promise<void>;
}

export async function createHarness(
  opts: { factCheck?: AppDeps['factCheck'] } = {},
): Promise<Harness> {
  const apiDb = await createTempDatabase();
  const vaultDb = await createTempDatabase();
  const apiPool = createPool(apiDb.url);
  const vaultPool = createPool(vaultDb.url);
  await migrate(apiPool, join(here, '..', 'migrations'));
  await migrate(vaultPool, join(here, '..', '..', 'vault', 'migrations'));

  const token = randomBytes(32).toString('hex');
  const lookupKey = randomBytes(32);
  const mail = new InMemoryEmailSender();
  const vaultApp = await buildVaultApp({
    serviceToken: token,
    service: new VaultService({
      pool: vaultPool,
      tokenKeys: parseKeyring(`1:${randomBytes(32).toString('base64')}`, 'K'),
      lookupKey,
      keyProvider: new LocalKeyProvider(randomBytes(32)),
      verifier: new FakeVerifier(),
      twoFactor: new ChannelRouter({ email: new EmailOtpProvider(vaultPool, lookupKey, mail) }),
    }),
  });
  const vaultFetch = (async (url: string, init: RequestInit = {}) => {
    const res = await vaultApp.inject({
      method: init.method as 'GET',
      url: new URL(url).pathname,
      headers: init.headers as Record<string, string>,
      ...(init.body ? { payload: init.body as string } : {}),
    });
    return new Response(res.body || null, { status: res.statusCode });
  }) as unknown as typeof fetch;

  const app = await buildApp({
    deps: {
      pool: apiPool,
      vault: new HttpVaultClient('http://vault.internal', token, vaultFetch),
      challenges: new MemoryChallengeStore(),
      rp: RP,
      cache: { versionCheckMs: 0 },
      ...(opts.factCheck ? { factCheck: opts.factCheck } : {}),
      rateLimit: {
        secret: randomBytes(32),
        routeLimits: {
          signup: relaxed,
          verification: relaxed,
          codeSend: relaxed,
          codeCheck: relaxed,
          signIn: relaxed,
          post: relaxed,
          comment: relaxed,
          request: relaxed,
          stance: relaxed,
        },
      },
    },
  });

  return {
    app,
    apiPool,
    mail,
    async close() {
      await app.close();
      await vaultApp.close();
      await apiPool.end();
      await vaultPool.end();
      await apiDb.drop();
      await vaultDb.drop();
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

let counter = 0;
export const identity = (overrides: Record<string, string> = {}) => ({
  firstName: 'Ida',
  lastName: 'Wells',
  birthDate: '1992-07-16',
  state: 'PA',
  licenseNumber: `P${(++counter).toString().padStart(7, '0')}${randomBytes(2).toString('hex')}`,
  ...overrides,
});

/** Creates an account and runs sign-up up to (and including) a registered passkey. */
export async function onboard(
  h: Harness,
  username: string,
  person = identity(),
): Promise<{ token: string; device: SoftAuthenticator; person: ReturnType<typeof identity> }> {
  const { app, mail } = h;
  const created = await app.inject({ method: 'POST', url: '/v1/accounts', payload: { username } });
  expect(created.statusCode).toBe(201);
  const token = created.json().token as string;
  const auth = bearer(token);
  const email = `${username}@example.com`;

  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/me/verification',
        headers: auth,
        payload: person,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/v1/me/contacts/email',
        headers: auth,
        payload: { value: email },
      })
    ).statusCode,
  ).toBe(202);
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
  const reg = await app.inject({
    method: 'POST',
    url: '/v1/me/passkeys',
    headers: auth,
    payload: { response: device.register(options) },
  });
  expect(reg.statusCode).toBe(201);
  return { token, device, person };
}

export async function signIn(
  h: Harness,
  device: SoftAuthenticator,
): Promise<LightMyRequestResponse> {
  const { challengeId, options } = (
    await h.app.inject({ method: 'POST', url: '/v1/auth/passkey/options' })
  ).json();
  return h.app.inject({
    method: 'POST',
    url: '/v1/auth/passkey',
    payload: { challengeId, response: device.authenticate(options) },
  });
}

/** Onboards a user, grants the moderator role directly in the DB (as the operator script does), and signs in. */
export async function moderator(h: Harness, username: string): Promise<string> {
  const { device } = await onboard(h, username);
  await h.apiPool.query(
    "INSERT INTO account_roles (account_id, role) SELECT id, 'moderator' FROM accounts WHERE username = $1",
    [username],
  );
  return (await signIn(h, device)).json().token as string;
}
