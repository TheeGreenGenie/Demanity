import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from '@demanity/db';
import { Redis } from 'ioredis';
import { buildApp, loggerOptions } from './app.js';
import { RedisChallengeStore } from './auth/challenges.js';
import { loadConfig, loadServiceConfig } from './config.js';
import { assertNoDevSeedData } from './dev-seed-guard.js';
import { recomputeRollups } from './civic/rollups.js';
import {
  ApiBudget,
  CONGRESS_BUDGET,
  COURTLISTENER_BUDGET,
  FEDERALREGISTER_BUDGET,
  ingestCaps,
  OPENSTATES_BUDGET,
} from './ingest/budget.js';
import { CourtListenerClient, syncRulings } from './ingest/courtlistener.js';
import { FederalRegisterClient, syncExecutiveOrders } from './ingest/federalregister.js';
import { syncMembers } from './ingest/members.js';
import { OpenStatesClient, syncStateBills } from './ingest/openstates.js';
import { CongressClient, syncCongressBills } from './ingest/congress.js';
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

// Every 5 minutes: if scoring inputs changed (citations accepted, votes cast),
// recompute all derived scores in one batch (docs/adr/0007-precomputed-civic-data.md).
let recomputing = false;
const rollups = setInterval(
  () => {
    if (recomputing) return;
    recomputing = true;
    pool
      .query<{ dirty: boolean }>('SELECT dirty FROM data_version')
      .then(async ({ rows }) => {
        if (!rows[0]?.dirty) return;
        const { version } = await recomputeRollups(pool);
        app.log.info({ version }, 'recomputed civic rollups');
      })
      .catch((err: Error) => app.log.error({ err: { name: err.name } }, 'rollup recompute failed'))
      .finally(() => {
        recomputing = false;
      });
  },
  5 * 60 * 1000,
);
rollups.unref();

// Hourly: sync new and updated bills from Congress.gov when a key is configured.
if (svc.dataGovApiKey) {
  const caps = ingestCaps(config.nodeEnv);
  const congress = new CongressClient(
    svc.dataGovApiKey,
    fetch,
    new ApiBudget(pool, 'congress.gov', { ...CONGRESS_BUDGET, perHour: caps.congressPerHour }),
  );
  let syncing = false;
  const ingest = setInterval(
    () => {
      if (syncing) return;
      syncing = true;
      syncCongressBills(pool, congress, {
        maxBills: caps.maxBillsPerRun,
        defaultLookbackDays: caps.lookbackDays,
      })
        .then((r) =>
          app.log.info(
            { bills: r.bills, stoppedEarly: r.stoppedEarly },
            'congress.gov sync complete',
          ),
        )
        .catch((err: Error) =>
          app.log.error({ err: { name: err.name } }, 'congress.gov sync failed'),
        )
        .finally(() => {
          syncing = false;
        });
    },
    60 * 60 * 1000,
  );
  ingest.unref();
}

// Every 6 hours: state bills (Open States) and court rulings (CourtListener).
// Their published daily limits are small (250 and 125), so runs are rare and
// each one is budgeted well under them (ADR 0008).
{
  const caps = ingestCaps(config.nodeEnv);
  const jobs: Array<() => Promise<unknown>> = [];
  if (svc.openStatesApiKey) {
    const states = new OpenStatesClient(
      svc.openStatesApiKey,
      fetch,
      new ApiBudget(pool, 'openstates', OPENSTATES_BUDGET),
    );
    jobs.push(() =>
      syncStateBills(pool, states, {
        pagesPerState: caps.statePagesPerRun,
        defaultLookbackDays: caps.lookbackDays,
      }).then((r) =>
        app.log.info({ bills: r.bills, stoppedEarly: r.stoppedEarly }, 'open states sync complete'),
      ),
    );
  }
  if (svc.courtListenerToken) {
    const courts = new CourtListenerClient(
      svc.courtListenerToken,
      fetch,
      new ApiBudget(pool, 'courtlistener', COURTLISTENER_BUDGET),
    );
    jobs.push(() =>
      syncRulings(pool, courts, { perCourt: caps.rulingsPerCourt }).then((r) =>
        app.log.info(
          { rulings: r.rulings, dockets: r.dockets, stoppedEarly: r.stoppedEarly },
          'courtlistener sync complete',
        ),
      ),
    );
  }
  // Sitting members of Congress (3 requests): lifecycle and photos stay current.
  if (svc.dataGovApiKey) {
    const key = svc.dataGovApiKey;
    const memberBudget = new ApiBudget(pool, 'congress.gov', {
      ...CONGRESS_BUDGET,
      perHour: caps.congressPerHour,
    });
    jobs.push(() =>
      syncMembers(pool, key, fetch, memberBudget).then((r) =>
        app.log.info(
          { current: r.current, leftOffice: r.leftOffice },
          'congress members sync complete',
        ),
      ),
    );
  }
  // Executive orders need no key; one request per run.
  {
    const orders = new FederalRegisterClient(
      fetch,
      new ApiBudget(pool, 'federalregister', FEDERALREGISTER_BUDGET),
    );
    jobs.push(() =>
      syncExecutiveOrders(pool, orders).then((r) =>
        app.log.info(
          { orders: r.orders, stoppedEarly: r.stoppedEarly },
          'federal register sync complete',
        ),
      ),
    );
  }
  if (jobs.length) {
    let running = false;
    const slow = setInterval(
      () => {
        if (running) return;
        running = true;
        (async () => {
          for (const job of jobs) await job();
        })()
          .catch((err: Error) => app.log.error({ err: { name: err.name } }, 'data sync failed'))
          .finally(() => {
            running = false;
          });
      },
      6 * 60 * 60 * 1000,
    );
    slow.unref();
  }
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
