// Sync bills from Congress.gov: pnpm --filter @demanity/api ingest:congress [--days N] [--max N]
// Needs DATA_GOV_API_KEY (free key: https://api.data.gov/signup/) and
// ACTIVITY_DATABASE_URL, from the repo-root .env or the environment.
// DATA_GOV_API_KEY=DEMO_KEY works for a quick try but is heavily rate-limited.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createPool, migrate } from '@demanity/db';
import { recomputeRollups } from '../civic/rollups.js';
import { ApiBudget, CONGRESS_BUDGET, ingestCaps } from './budget.js';
import { CongressClient, syncCongressBills } from './congress.js';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values } = parseArgs({
  options: { days: { type: 'string' }, max: { type: 'string' } },
});
const key = process.env.DATA_GOV_API_KEY;
if (!key || !process.env.ACTIVITY_DATABASE_URL) {
  console.error('Set DATA_GOV_API_KEY and ACTIVITY_DATABASE_URL (see .env.example).');
  process.exit(2);
}

const pool = createPool(process.env.ACTIVITY_DATABASE_URL);
try {
  await migrate(pool, join(here, '..', '..', 'migrations'));
  // Small by default outside production: we only want a sample of real data.
  const caps = ingestCaps(process.env.NODE_ENV);
  const days = values.days ? Number(values.days) : undefined;
  const since = days ? new Date(Date.now() - days * 86_400_000) : undefined;
  const budget = new ApiBudget(pool, 'congress.gov', {
    ...CONGRESS_BUDGET,
    perHour: caps.congressPerHour,
  });
  const result = await syncCongressBills(pool, new CongressClient(key, fetch, budget), {
    ...(since ? { since } : {}),
    defaultLookbackDays: caps.lookbackDays,
    maxBills: Math.min(
      values.max ? Number(values.max) : caps.maxBillsPerRun,
      caps.maxBillsPerRun * 4,
    ),
  });
  if (result.stoppedEarly) console.log(`Stopped early: ${result.stoppedEarly}`);
  console.log(
    `Requests used this hour: ${await budget.usedThisHour()} of ${caps.congressPerHour}.`,
  );
  await recomputeRollups(pool);
  console.log(
    `Synced ${result.bills} bills (${result.leaders} new members of Congress); data through ${result.through.toISOString()}.`,
  );
} finally {
  await pool.end();
}
