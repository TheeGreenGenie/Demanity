import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import type { Pool } from '@demanity/db';
import { ROUTE_LIMITS, rateLimitKey, type RouteLimits } from './rate-limit.js';
import { ResponseCache } from './cache.js';
import { applicationRoutes } from './routes/applications.js';
import { contentModerationRoutes } from './routes/content-moderation.js';
import { citationRoutes } from './routes/citations.js';
import { civicRoutes } from './routes/civic.js';
import { moderationRoutes } from './routes/moderation.js';
import { socialRoutes } from './routes/social.js';
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
  /** Response cache tuning; tests use versionCheckMs: 0 to see recomputes immediately. */
  cache?: { versionCheckMs?: number };
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
    // CORS: only the app's own origins (the same list WebAuthn trusts). Bearer
    // tokens, not cookies, so credentials are never sent cross-origin.
    await app.register(cors, {
      origin: rp.origins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['authorization', 'content-type'],
      credentials: false,
      maxAge: 600,
    });
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
    await app.register(async (scoped) =>
      socialRoutes(scoped, { pool, limits: rl.routeLimits ?? ROUTE_LIMITS }),
    );
    // One shared response cache for all public, viewer-independent pages (ADR 0007).
    const cache = new ResponseCache(pool, options.deps.cache ?? {});
    const limits = rl.routeLimits ?? ROUTE_LIMITS;
    await app.register(async (scoped) => civicRoutes(scoped, { pool, limits, cache }));
    await app.register(async (scoped) => citationRoutes(scoped, { pool, limits, cache }));
    await app.register(async (scoped) => applicationRoutes(scoped, { pool, limits }));
    await app.register(async (scoped) => contentModerationRoutes(scoped, { pool, limits }));
  }

  return app;
}

export const loggerOptions = (level: string): FastifyServerOptions['logger'] => ({
  level,
  serializers: { req: serializeRequest },
});
