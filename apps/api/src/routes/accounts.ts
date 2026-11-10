import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Pool } from '@demanity/db';
import { requireSession } from '../auth/guard.js';
import { PasskeyError, type Passkeys } from '../auth/passkeys.js';
import { createSession, deleteSession } from '../auth/sessions.js';
import { ROUTE_LIMITS, type RouteLimits } from '../rate-limit.js';
import {
  VaultClientError,
  type Channel,
  type IdentityPayload,
  type Vault,
} from '../vault-client.js';

export interface AccountRouteDeps {
  pool: Pool;
  vault: Vault;
  passkeys: Passkeys;
  limits?: RouteLimits;
}

const channel = { type: 'string', enum: ['sms', 'email'] } as const;

const VAULT_STATUS: Partial<Record<VaultClientError['code'], number>> = {
  duplicate_identity: 409,
  banned: 403,
  not_verified: 422,
  under_18: 422,
  contact_in_use: 409,
  no_contact: 404,
  invalid_input: 400,
};

function sendVaultError(reply: FastifyReply, err: unknown) {
  if (err instanceof VaultClientError && VAULT_STATUS[err.code]) {
    return reply.code(VAULT_STATUS[err.code]!).send({ error: err.code });
  }
  throw err;
}

function sendPasskeyError(reply: FastifyReply, err: unknown) {
  if (err instanceof PasskeyError) return reply.code(400).send({ error: err.code });
  throw err;
}

export async function accountRoutes(app: FastifyInstance, deps: AccountRouteDeps) {
  const { pool, vault, passkeys } = deps;
  const limits = deps.limits ?? ROUTE_LIMITS;

  // --- Sign-up -------------------------------------------------------------

  app.post(
    '/v1/accounts',
    {
      config: { rateLimit: limits.signup },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username'],
          properties: { username: { type: 'string', pattern: '^[a-z0-9_]{3,30}$' } },
        },
      },
    },
    async (req, reply) => {
      const { username } = req.body as { username: string };
      try {
        const { rows } = await pool.query<{ id: string }>(
          'INSERT INTO accounts (username, webauthn_user_id) VALUES ($1, $2) RETURNING id',
          [username, randomBytes(32)],
        );
        const token = await createSession(pool, rows[0]!.id, 'onboarding');
        return reply.code(201).send({ token, status: 'pending' });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          return reply.code(409).send({ error: 'username_taken' });
        }
        throw err;
      }
    },
  );

  app.get(
    '/v1/me',
    { preHandler: requireSession({ scopes: ['onboarding', 'recovery', 'full'] }) },
    async (req) => ({
      username: req.session!.username,
      status: req.session!.status,
      scope: req.session!.scope,
    }),
  );

  app.post(
    '/v1/me/verification',
    {
      config: { rateLimit: limits.verification },
      preHandler: requireSession({ scopes: ['onboarding'], statuses: ['pending'] }),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['firstName', 'lastName', 'birthDate', 'state', 'licenseNumber'],
          properties: {
            firstName: { type: 'string', minLength: 1, maxLength: 100 },
            lastName: { type: 'string', minLength: 1, maxLength: 100 },
            birthDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            state: { type: 'string', minLength: 2, maxLength: 2 },
            licenseNumber: { type: 'string', minLength: 4, maxLength: 30 },
          },
        },
      },
    },
    async (req, reply) => {
      const accountId = req.session!.accountId;
      try {
        const result = await vault.verifyIdentity(accountId, req.body as IdentityPayload);
        if (result === 'needs_review') {
          return reply.code(202).send({ status: 'pending', review: 'moderator_queue' });
        }
        await pool.query("UPDATE accounts SET status = 'verified' WHERE id = $1", [accountId]);
        return { status: 'verified' };
      } catch (err) {
        return sendVaultError(reply, err);
      }
    },
  );

  // --- 2FA contacts (R26) --------------------------------------------------

  const verifiedOrActive = requireSession({
    scopes: ['onboarding', 'full'],
    statuses: ['verified', 'active'],
  });

  app.put(
    '/v1/me/contacts/:channel',
    {
      config: { rateLimit: limits.codeSend },
      preHandler: verifiedOrActive,
      schema: {
        params: { type: 'object', properties: { channel } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: { value: { type: 'string', minLength: 3, maxLength: 254 } },
        },
      },
    },
    async (req, reply) => {
      const { channel: ch } = req.params as { channel: Channel };
      try {
        await vault.setContact(req.session!.accountId, ch, (req.body as { value: string }).value);
        await vault.startTwoFactor(req.session!.accountId, ch);
        return reply.code(202).send({ status: 'code_sent' });
      } catch (err) {
        return sendVaultError(reply, err);
      }
    },
  );

  app.post(
    '/v1/me/contacts/:channel/confirm',
    {
      config: { rateLimit: limits.codeCheck },
      preHandler: verifiedOrActive,
      schema: {
        params: { type: 'object', properties: { channel } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['code'],
          properties: { code: { type: 'string', minLength: 4, maxLength: 10 } },
        },
      },
    },
    async (req, reply) => {
      const { channel: ch } = req.params as { channel: Channel };
      try {
        const ok = await vault.checkTwoFactor(
          req.session!.accountId,
          ch,
          (req.body as { code: string }).code,
        );
        if (!ok) return reply.code(400).send({ error: 'invalid_code' });
        await pool.query(
          "UPDATE accounts SET status = 'active' WHERE id = $1 AND status = 'verified'",
          [req.session!.accountId],
        );
        return { status: 'active' };
      } catch (err) {
        return sendVaultError(reply, err);
      }
    },
  );

  // --- Passkeys (R6) -------------------------------------------------------

  const canRegisterPasskey = requireSession({
    scopes: ['onboarding', 'recovery', 'full'],
    statuses: ['active'],
  });

  app.post('/v1/me/passkeys/options', { preHandler: canRegisterPasskey }, async (req) =>
    passkeys.registrationOptions(req.session!.accountId),
  );

  app.post(
    '/v1/me/passkeys',
    {
      preHandler: canRegisterPasskey,
      schema: { body: { type: 'object', required: ['response'] } },
    },
    async (req, reply) => {
      const response = (req.body as { response: RegistrationResponseJSON }).response;
      const recovery = req.session!.scope === 'recovery';
      try {
        const result = await passkeys.register(req.session!.accountId, response, recovery);
        if (recovery && req.sessionToken) await deleteSession(pool, req.sessionToken);
        return reply.code(201).send(result);
      } catch (err) {
        return sendPasskeyError(reply, err);
      }
    },
  );

  // --- Sign-in ---------------------------------------------------------------

  app.post('/v1/auth/passkey/options', async () => {
    const challengeId = randomUUID();
    return { challengeId, options: await passkeys.authenticationOptions(challengeId) };
  });

  app.post(
    '/v1/auth/passkey',
    {
      config: { rateLimit: limits.signIn },
      schema: {
        body: {
          type: 'object',
          required: ['challengeId', 'response'],
          properties: { challengeId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (req, reply) => {
      const { challengeId, response } = req.body as {
        challengeId: string;
        response: AuthenticationResponseJSON;
      };
      try {
        const accountId = await passkeys.authenticate(challengeId, response);
        return { token: await createSession(pool, accountId, 'full') };
      } catch (err) {
        return sendPasskeyError(reply, err);
      }
    },
  );

  app.post('/v1/auth/logout', async (req, reply) => {
    if (req.sessionToken) await deleteSession(pool, req.sessionToken);
    return reply.code(204).send();
  });

  // --- Recovery: lost device (R26) -------------------------------------------
  // Responses never reveal whether a username exists.

  const recoveryBody = {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'channel'],
    properties: { username: { type: 'string', maxLength: 30 }, channel },
  } as const;

  async function activeAccountId(username: string): Promise<string | null> {
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM accounts WHERE username = $1 AND status = 'active'",
      [username],
    );
    return rows[0]?.id ?? null;
  }

  app.post(
    '/v1/auth/recovery/start',
    { config: { rateLimit: limits.codeSend }, schema: { body: recoveryBody } },
    async (req, reply) => {
      const { username, channel: ch } = req.body as { username: string; channel: Channel };
      const accountId = await activeAccountId(username);
      if (accountId) {
        await vault.startTwoFactor(accountId, ch).catch((err) => {
          if (!(err instanceof VaultClientError)) throw err; // e.g. no contact on that channel
        });
      }
      return reply.code(202).send({ status: 'if_account_exists_code_sent' });
    },
  );

  app.post(
    '/v1/auth/recovery/verify',
    {
      config: { rateLimit: limits.codeCheck },
      schema: {
        body: {
          ...recoveryBody,
          required: ['username', 'channel', 'code'],
          properties: {
            ...recoveryBody.properties,
            code: { type: 'string', minLength: 4, maxLength: 10 },
          },
        },
      },
    },
    async (req, reply) => {
      const {
        username,
        channel: ch,
        code,
      } = req.body as { username: string; channel: Channel; code: string };
      const accountId = await activeAccountId(username);
      const ok = accountId
        ? await vault.checkTwoFactor(accountId, ch, code).catch(() => false)
        : false;
      if (!ok || !accountId) return reply.code(400).send({ error: 'invalid_code' });
      return { token: await createSession(pool, accountId, 'recovery') };
    },
  );
}
