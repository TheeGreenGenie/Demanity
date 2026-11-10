import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, type Pool } from '@demanity/db';
import { createTempDatabase } from '@demanity/db/testing';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryChallengeStore } from '../src/auth/challenges.js';
import type { Vault } from '../src/vault-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
const unusedVault = {} as Vault; // sign-up never reaches the vault

let pool: Pool;
let drop: () => Promise<void>;
let redis: Redis;
let app: FastifyInstance;
const nameSpace = 'demanity-rl:';

beforeAll(async () => {
  const db = await createTempDatabase();
  drop = db.drop;
  pool = createPool(db.url);
  await migrate(pool, join(here, '..', 'migrations'));
  redis = new Redis(REDIS_URL, { connectTimeout: 2000, maxRetriesPerRequest: 1 });
  const stale = await redis.keys(`${nameSpace}*`);
  if (stale.length) await redis.del(...stale);
  app = await buildApp({
    deps: {
      pool,
      vault: unusedVault,
      challenges: new MemoryChallengeStore(),
      rp: { id: 'localhost', name: 'Demanity', origins: ['http://localhost:8081'] },
      rateLimit: { secret: randomBytes(32), redis }, // production route limits
    },
  });
});

afterAll(async () => {
  await app?.close();
  const keys = (await redis?.keys(`${nameSpace}*`)) ?? [];
  if (keys.length) await redis.del(...keys);
  redis?.disconnect();
  await pool?.end();
  await drop?.();
});

describe('rate limiting (real Redis, production limits)', () => {
  it('throttles sign-ups per network and stores only hashed keys with expiry', async () => {
    const ip = '198.51.100.23';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/accounts',
        remoteAddress: ip,
        payload: { username: `rl_user_${i}` },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);

    // A different network is unaffected.
    const other = await app.inject({
      method: 'POST',
      url: '/v1/accounts',
      remoteAddress: '203.0.113.99',
      payload: { username: 'rl_other' },
    });
    expect(other.statusCode).toBe(201);

    const keys = await redis.keys(`${nameSpace}*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('198.51.100.23');
      expect(key).not.toContain('203.0.113.99');
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(0); // every counter expires
      expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000); // no longer than its window (max 1 hour)
    }
  });
});
