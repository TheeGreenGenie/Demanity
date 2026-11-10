import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import type { Pool } from '@demanity/db';
import { ROUTE_LIMITS, rateLimitKey, type RouteLimits } from './rate-limit.js';
import { moderationRoutes } from './routes/moderation.js';
import { loadSession } from './auth/guard.js';
import { Passkeys, type RelyingParty } from './auth/passkeys.js';
import type { ChallengeStore } from './auth/challenges.js';
import { accountRoutes } from './routes/accounts.js';
import { healthRoutes } from './routes/health.js';
import type { Vault } from './vault-client.js';

/**
 * Privacy-preserving request serializer (docs/PRIVACY.md).
 *
 * Logs only the method and URL. Deliberately omits:
 * - remote address/port (IP retention is forbidden beyond short-lived hashed rate limiting)
 * - all headers (X-Forwarded-For carries IPs; Cookie/Authorization carry secrets)
 */
export function serializeRequest(request: { method: string; url: string }) {
  return { method: request.method, url: request.url };
}

export interface AppDeps {
  pool: Pool;
  vault: Vault;
  challenges: ChallengeStore;
  rp: RelyingParty;
  /** Rate limiting with hashed IP keys. Without `redis`, counters are in-process (tests/dev). */
  rateLimit: { secret: Buffer; redis?: Redis; now?: () => Date; routeLimits?: RouteLimits };
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  deps?: AppDeps;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // Never trust proxy headers implicitly; configure explicitly per deployment.
    trustProxy: false,
    bodyLimit: 64 * 1024,
    // Reject unknown fields instead of silently stripping them.
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.decorateRequest('session', null);
  app.decorateRequest('sessionToken', null);

  await app.register(healthRoutes);

  if (options.deps) {
    const { pool, vault, challenges, rp, rateLimit: rl } = options.deps;
    await app.register(rateLimit, {
      max: 300,
      timeWindow: '1 minute',
      keyGenerator: (req) => rateLimitKey(rl.secret, req.ip, rl.now?.() ?? new Date()),
      ...(rl.redis ? { redis: rl.redis, nameSpace: 'demanity-rl:' } : {}),
    });
    app.addHook('onRequest', loadSession(pool));
    await app.register(async (scoped) =>
      accountRoutes(scoped, {
        pool,
        vault,
        passkeys: new Passkeys(pool, challenges, rp),
        ...(rl.routeLimits ? { limits: rl.routeLimits } : {}),
      }),
    );
    await app.register(async (scoped) =>
      moderationRoutes(scoped, { pool, vault, limits: rl.routeLimits ?? ROUTE_LIMITS }),
    );
  }

  return app;
}

export const loggerOptions = (level: string): FastifyServerOptions['logger'] => ({
  level,
  serializers: { req: serializeRequest },
});
