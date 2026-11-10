import { buildApp, loggerOptions } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({ logger: loggerOptions(config.logLevel) });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
