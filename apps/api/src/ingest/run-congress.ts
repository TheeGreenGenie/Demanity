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
import { CongressClient, syncCongressBills } from './congress.js';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values } = parseArgs({
  options: { days: { type: 'string' }, max: { type: 'string', default: '200' } },
});
const key = process.env.DATA_GOV_API_KEY;
if (!key || !process.env.ACTIVITY_DATABASE_URL) {
  console.error('Set DATA_GOV_API_KEY and ACTIVITY_DATABASE_URL (see .env.example).');
  process.exit(2);
}

const pool = createPool(process.env.ACTIVITY_DATABASE_URL);
try {
  await migrate(pool, join(here, '..', '..', 'migrations'));
  const since = values.days ? new Date(Date.now() - Number(values.days) * 86_400_000) : undefined;
  const result = await syncCongressBills(pool, new CongressClient(key), {
    ...(since ? { since } : {}),
    maxBills: Number(values.max),
  });
  await recomputeRollups(pool);
  console.log(
    `Synced ${result.bills} bills (${result.leaders} new members of Congress); data through ${result.through.toISOString()}.`,
  );
} finally {
  await pool.end();
}
