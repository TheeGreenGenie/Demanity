// Pre-launch cleanup: pnpm --filter @demanity/api sample-data:clear
// Deletes every sample row ([Sample] posts and requests, sample places,
// fictional leaders, made-up scores, statistics and bills). Real rows stay.
// Uses ACTIVITY_DATABASE_URL from the repo-root .env (or the environment).

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from '@demanity/db';
import { clearSampleData } from './seed-sample-civic.js';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.ACTIVITY_DATABASE_URL) {
  console.error('ACTIVITY_DATABASE_URL is not set.');
  process.exit(2);
}
const pool = createPool(process.env.ACTIVITY_DATABASE_URL);
try {
  await migrate(pool, join(here, '..', 'migrations'));
  await clearSampleData(pool);
  console.log('Sample data deleted. Dev seed accounts are separate: see the pre-launch checklist.');
} finally {
  await pool.end();
}
