// Manual ingestion runs, all under the same budgets as the server (ADR 0008):
//   pnpm --filter @demanity/api ingest:congress   (DATA_GOV_API_KEY)
//   pnpm --filter @demanity/api ingest:states     (OPENSTATES_API_KEY)
//   pnpm --filter @demanity/api ingest:courts     (COURTLISTENER_API_TOKEN)
// Keys and ACTIVITY_DATABASE_URL come from the repo-root .env or the
// environment. Keys are never printed.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createPool, migrate } from '@demanity/db';
import { recomputeRollups } from '../civic/rollups.js';
import {
  ApiBudget,
  CONGRESS_BUDGET,
  COURTLISTENER_BUDGET,
  FEDERALREGISTER_BUDGET,
  ingestCaps,
  OPENSTATES_BUDGET,
} from './budget.js';
import { CongressClient, syncCongressBills } from './congress.js';
import { CourtListenerClient, syncRulings } from './courtlistener.js';
import { FederalRegisterClient, syncExecutiveOrders } from './federalregister.js';
import { OpenStatesClient, syncStateBills } from './openstates.js';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    days: { type: 'string' },
    max: { type: 'string' },
  },
});
const need = (name: string) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Set ${name} in .env (see .env.example).`);
    process.exit(2);
  }
  return v;
};

const pool = createPool(need('ACTIVITY_DATABASE_URL'));
const caps = ingestCaps(process.env.NODE_ENV);
try {
  await migrate(pool, join(here, '..', '..', 'migrations'));
  if (values.source === 'congress') {
    const budget = new ApiBudget(pool, 'congress.gov', {
      ...CONGRESS_BUDGET,
      perHour: caps.congressPerHour,
    });
    const days = values.days ? Number(values.days) : undefined;
    const r = await syncCongressBills(
      pool,
      new CongressClient(need('DATA_GOV_API_KEY'), fetch, budget),
      {
        ...(days ? { since: new Date(Date.now() - days * 86_400_000) } : {}),
        defaultLookbackDays: caps.lookbackDays,
        maxBills: Math.min(
          values.max ? Number(values.max) : caps.maxBillsPerRun,
          caps.maxBillsPerRun * 4,
        ),
      },
    );
    console.log(`Congress.gov: ${r.bills} bills, ${r.leaders} new members of Congress.`);
    if (r.stoppedEarly) console.log(`Stopped early: ${r.stoppedEarly}`);
    console.log(`Requests this hour: ${await budget.used('hour')} of ${caps.congressPerHour}.`);
  } else if (values.source === 'states') {
    const budget = new ApiBudget(pool, 'openstates', OPENSTATES_BUDGET);
    const r = await syncStateBills(
      pool,
      new OpenStatesClient(need('OPENSTATES_API_KEY'), fetch, budget),
      { pagesPerState: caps.statePagesPerRun, defaultLookbackDays: caps.lookbackDays },
    );
    console.log(`Open States: ${r.bills} state bills, ${r.leaders} new state legislators.`);
    if (r.stoppedEarly) console.log(`Stopped early: ${r.stoppedEarly}`);
    console.log(`Requests today: ${await budget.used('day')} of ${OPENSTATES_BUDGET.perDay}.`);
  } else if (values.source === 'courts') {
    const budget = new ApiBudget(pool, 'courtlistener', COURTLISTENER_BUDGET);
    const r = await syncRulings(
      pool,
      new CourtListenerClient(need('COURTLISTENER_API_TOKEN'), fetch, budget),
      { perCourt: caps.rulingsPerCourt },
    );
    console.log(`CourtListener: ${r.dockets} case filings, ${r.rulings} opinions.`);
    if (r.stoppedEarly) console.log(`Stopped early: ${r.stoppedEarly}`);
    console.log(`Requests today: ${await budget.used('day')} of ${COURTLISTENER_BUDGET.perDay}.`);
  } else if (values.source === 'orders') {
    const budget = new ApiBudget(pool, 'federalregister', FEDERALREGISTER_BUDGET);
    const r = await syncExecutiveOrders(pool, new FederalRegisterClient(fetch, budget));
    console.log(`Federal Register: ${r.orders} executive orders.`);
    if (r.stoppedEarly) console.log(`Stopped early: ${r.stoppedEarly}`);
  } else {
    console.error('Use --source congress | states | courts | orders');
    process.exit(2);
  }
  await recomputeRollups(pool);
} finally {
  await pool.end();
}
