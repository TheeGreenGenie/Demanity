import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from '@demanity/db';
import { buildVaultApp, serializeRequest } from './app.js';
import { buildTwoFactor, loadVaultConfig } from './config.js';
import { VaultService } from './service.js';

const config = loadVaultConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool, join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));

const service = new VaultService({ pool, ...config, twoFactor: buildTwoFactor(config, pool) });
const app = await buildVaultApp({
  service,
  serviceToken: config.serviceToken,
  logger: { level: config.logLevel, serializers: { req: serializeRequest } },
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
