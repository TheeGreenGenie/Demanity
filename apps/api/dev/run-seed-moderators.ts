// DEVELOPMENT ONLY: pnpm --filter @demanity/api seed:dev-moderators
// Creates (or re-issues tokens for) dev_mod_1 and dev_mod_2.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from '@demanity/db';
import { buildTwoFactor, loadVaultConfig } from '../../vault/src/config.js';
import { VaultService } from '../../vault/src/service.js';
import { seedDevModerators } from './seed-moderators.js';
import { seedSampleContent } from './seed-sample-content.js';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '..', '..', '.env');
if (!existsSync(envFile)) {
  console.error(
    'No .env at the repo root. Copy .env.example and run `node scripts/gen-secrets.mjs`.',
  );
  process.exit(2);
}
process.loadEnvFile(envFile);

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV=production.');
  process.exit(2);
}
for (const name of ['ACTIVITY_DATABASE_URL', 'VAULT_DATABASE_URL']) {
  const host = new URL(process.env[name] ?? 'postgres://missing').hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.error(`Refusing to seed: ${name} points at ${host}, not a local database.`);
    process.exit(2);
  }
}

const apiPool = createPool(process.env.ACTIVITY_DATABASE_URL!);
const vaultPool = createPool(process.env.VAULT_DATABASE_URL!);
try {
  await migrate(apiPool, join(here, '..', 'migrations'));
  await migrate(vaultPool, join(here, '..', '..', 'vault', 'migrations'));
  const config = loadVaultConfig();
  const vault = new VaultService({
    pool: vaultPool,
    ...config,
    twoFactor: buildTwoFactor(config, vaultPool),
  });

  const seeded = await seedDevModerators({ apiPool, vaultPool, vault });
  const samples = await seedSampleContent(apiPool);
  console.log('\nDevelopment moderator accounts (NEVER use in production):\n');
  for (const m of seeded) {
    console.log(`  ${m.username} (${m.created ? 'created' : 'already existed, new token issued'})`);
    console.log(`    Authorization: Bearer ${m.token}`);
  }
  console.log(`\nTokens are full sessions valid for ${seeded[0]?.expiresInDays ?? 30} days.`);
  console.log(
    samples.skipped
      ? 'Sample posts already present.'
      : `Added ${samples.created} [Sample] posts for UI work.`,
  );
  console.log('Production refuses to start while these accounts exist.\n');
} finally {
  await apiPool.end();
  await vaultPool.end();
}
