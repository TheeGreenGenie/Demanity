import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './routes/health.js';

/**
 * Privacy-preserving request serializer (docs/PRIVACY.md).
 *
 * Logs only the method and URL. Deliberately omits:
 * - remote address/port (IP retention is forbidden beyond short-lived hashed rate limiting)
 * - all headers (X-Forwarded-For carries IPs; Cookie/Authorization carry secrets)
 */
export function serializeRequest(request: { method: string; url: string }) {
  return { method: request.method, url: request.url };
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // Never trust proxy headers implicitly; configure explicitly per deployment.
    trustProxy: false,
  });

  await app.register(healthRoutes);

  return app;
}

export const loggerOptions = (level: string): FastifyServerOptions['logger'] => ({
  level,
  serializers: { req: serializeRequest },
});
