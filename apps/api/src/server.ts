import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from '@demanity/db';
import { Redis } from 'ioredis';
import { buildApp, loggerOptions } from './app.js';
import { RedisChallengeStore } from './auth/challenges.js';
import { loadConfig, loadServiceConfig } from './config.js';
import { assertNoDevSeedData } from './dev-seed-guard.js';
import { deleteStalePendingAccounts } from './moderation/service.js';
import { HttpVaultClient } from './vault-client.js';

const config = loadConfig();
const svc = loadServiceConfig();

const pool = createPool(svc.databaseUrl);
await migrate(pool, join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
if (config.nodeEnv === 'production') await assertNoDevSeedData(pool);

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

// Hourly: free usernames held by sign-ups that never verified within 24 hours.
const cleanup = setInterval(
  () => {
    deleteStalePendingAccounts(pool)
      .then((n) => n > 0 && app.log.info({ deleted: n }, 'removed stale pending accounts'))
      .catch((err: Error) => app.log.error({ err: { name: err.name } }, 'pending cleanup failed'));
  },
  60 * 60 * 1000,
);
cleanup.unref();

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
