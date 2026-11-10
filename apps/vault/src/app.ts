import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { InvalidAttributesError } from './crypto/token.js';
import type { Channel } from './providers/two-factor.js';
import { VaultError, type VaultService } from './service.js';

/**
 * Internal vault HTTP API. Only the Demanity API calls it, authenticated with a
 * shared service token; it must never be exposed publicly. Request bodies are
 * never logged (Fastify does not log bodies, and the serializer below drops
 * headers and addresses).
 */

export const serializeRequest = (r: { method: string; url: string }) => ({
  method: r.method,
  url: r.url,
});

const STATUS: Record<VaultError['code'], number> = {
  duplicate_identity: 409,
  banned: 403,
  not_verified: 422,
  under_18: 422,
  needs_review: 202,
  unknown_account: 404,
  contact_in_use: 409,
  no_contact: 404,
  invalid_input: 400,
};

const uuid = { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' } as const;
const channel = { type: 'string', enum: ['sms', 'email'] } as const;

function tokensMatch(expected: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function buildVaultApp(opts: {
  service: VaultService;
  serviceToken: string;
  logger?: FastifyServerOptions['logger'];
}): Promise<FastifyInstance> {
  if (opts.serviceToken.length < 32)
    throw new Error('Vault service token must be at least 32 characters');
  const expected = Buffer.from(opts.serviceToken);
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: false,
    bodyLimit: 16 * 1024,
    // Fastify's default Ajv config silently strips unknown fields; we reject them
    // instead, so clients can never send identity data we did not ask for.
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!tokensMatch(expected, req.headers.authorization)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof VaultError) {
      return reply.code(STATUS[err.code]).send({ error: err.code });
    }
    if (err instanceof InvalidAttributesError) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    if ((err as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    // Never echo internal error details (they could contain sensitive values).
    app.log.error({ err: { name: (err as Error).name } }, 'vault internal error');
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/health', async () => ({ status: 'ok' as const }));

  app.post(
    '/v1/identities/verify',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['accountId', 'firstName', 'lastName', 'birthDate', 'state', 'licenseNumber'],
          properties: {
            accountId: uuid,
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
      const { accountId, ...person } = req.body as {
        accountId: string;
        firstName: string;
        lastName: string;
        birthDate: string;
        state: string;
        licenseNumber: string;
      };
      const { identityId } = await opts.service.verifyAndRegister(accountId, person);
      return reply.code(201).send({ status: 'verified', identityId });
    },
  );

  app.put(
    '/v1/accounts/:accountId/contacts/:channel',
    {
      schema: {
        params: {
          type: 'object',
          required: ['accountId', 'channel'],
          properties: { accountId: uuid, channel },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: { value: { type: 'string', minLength: 3, maxLength: 254 } },
        },
      },
    },
    async (req, reply) => {
      const { accountId, channel: ch } = req.params as { accountId: string; channel: Channel };
      await opts.service.setContact(accountId, ch, (req.body as { value: string }).value);
      return reply.code(204).send();
    },
  );

  app.post(
    '/v1/accounts/:accountId/2fa/:channel/start',
    {
      schema: {
        params: {
          type: 'object',
          required: ['accountId', 'channel'],
          properties: { accountId: uuid, channel },
        },
      },
    },
    async (req, reply) => {
      const { accountId, channel: ch } = req.params as { accountId: string; channel: Channel };
      await opts.service.startTwoFactor(accountId, ch);
      return reply.code(202).send({ status: 'sent' });
    },
  );

  app.post(
    '/v1/accounts/:accountId/2fa/:channel/check',
    {
      schema: {
        params: {
          type: 'object',
          required: ['accountId', 'channel'],
          properties: { accountId: uuid, channel },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['code'],
          properties: { code: { type: 'string', minLength: 4, maxLength: 10 } },
        },
      },
    },
    async (req) => {
      const { accountId, channel: ch } = req.params as { accountId: string; channel: Channel };
      const ok = await opts.service.checkTwoFactor(
        accountId,
        ch,
        (req.body as { code: string }).code,
      );
      return { approved: ok };
    },
  );

  return app;
}
