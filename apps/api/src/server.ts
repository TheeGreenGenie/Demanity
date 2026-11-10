import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from '@demanity/db';
import { Redis } from 'ioredis';
import { buildApp, loggerOptions } from './app.js';
import { RedisChallengeStore } from './auth/challenges.js';
import { loadConfig, loadServiceConfig } from './config.js';
import { HttpVaultClient } from './vault-client.js';

const config = loadConfig();
const svc = loadServiceConfig();

const pool = createPool(svc.databaseUrl);
await migrate(pool, join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));

// Settings recommended for rate limiting: fail fast instead of queueing.
const redis = new Redis(svc.redisUrl, { connectTimeout: 2000, maxRetriesPerRequest: 1 });

const app = await buildApp({
  logger: loggerOptions(config.logLevel),
  deps: {
    pool,
    vault: new HttpVaultClient(svc.vaultUrl, svc.vaultServiceToken),
    challenges: new RedisChallengeStore(redis),
    rp: svc.rp,
    rateLimit: { secret: svc.rateLimitSecret, redis },
  },
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
