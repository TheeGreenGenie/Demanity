// Runtime configuration, read from environment variables.
// Secrets never have defaults; anything required fails fast at startup.

export interface Config {
  host: string;
  port: number;
  logLevel: string;
  nodeEnv: 'development' | 'test' | 'production';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error(`Invalid NODE_ENV: ${nodeEnv}`);
  }

  const port = Number(env.API_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid API_PORT: ${env.API_PORT}`);
  }

  return {
    host: env.API_HOST ?? '127.0.0.1',
    port,
    logLevel: env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug'),
    nodeEnv,
  };
}

export interface ServiceConfig {
  databaseUrl: string;
  redisUrl: string;
  vaultUrl: string;
  vaultServiceToken: string;
  rateLimitSecret: Buffer;
  rp: { id: string; name: string; origins: string[] };
  /** Optional: enables the hourly Congress.gov sync (api.data.gov key). */
  dataGovApiKey: string | null;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const secret = Buffer.from(required(env, 'RATE_LIMIT_SECRET'), 'base64');
  if (secret.length !== 32) throw new Error('RATE_LIMIT_SECRET must be 32 bytes (base64)');

  const origins = required(env, 'WEBAUTHN_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (env.NODE_ENV === 'production' && origins.some((o) => !o.startsWith('https://'))) {
    throw new Error('Production WebAuthn origins must use https');
  }

  return {
    databaseUrl: required(env, 'ACTIVITY_DATABASE_URL'),
    redisUrl: required(env, 'REDIS_URL'),
    vaultUrl: required(env, 'VAULT_URL'),
    vaultServiceToken: required(env, 'VAULT_SERVICE_TOKEN'),
    rateLimitSecret: secret,
    rp: { id: required(env, 'WEBAUTHN_RP_ID'), name: 'Demanity', origins },
    dataGovApiKey: env.DATA_GOV_API_KEY || null,
  };
}
